---
title: "System Design: Video Streaming Platform at Netflix Scale"
description: "Design a video streaming platform handling 250M users and 15% of global internet traffic. Covers video transcoding pipeline, CDN architecture, adaptive bitrate streaming, and recommendation systems."
date: "2025-03-19"
category: "System Design"
tags: ["system design", "video streaming", "cdn", "aws", "distributed systems", "hls"]
featured: false
affiliateSection: "system-design-courses"
---

Netflix accounts for 15% of global internet traffic. At peak, it serves 250 million concurrent streams — each stream adapting in real-time to network conditions, each segment served from servers 20ms away from the viewer. The architecture behind this solves problems that span encoding theory, distributed systems, network optimization, and machine learning.

## Requirements

**Functional:**
- Users upload videos (creators) or watch licensed content
- Video plays within 2 seconds of click (fast start)
- Adaptive quality (auto-adjusts 360p → 1080p → 4K based on bandwidth)
- Resume playback across devices
- Offline download
- Personalized recommendations

**Non-Functional:**
- 250M DAU, 500M total subscribers
- 15B streaming hours per month
- P99 start time < 2 seconds
- Rebuffering rate < 0.5% (buffer = video pauses to load = terrible UX)
- Upload: encode 1 hour of 4K video in < 30 minutes

## The Video Pipeline: Upload to Playback

Before going deep on any individual component, it helps to see the entire pipeline end to end. Video streaming has two distinct data flows that operate independently: the upload and transcoding path (happens once per video), and the playback path (happens billions of times per video). Understanding this asymmetry — encode once, serve forever — is the core architectural principle that makes the economics work.

```
Creator Upload                    Viewer Playback
      │                                  │
      ▼                                  ▼
Raw video file              ┌─── CDN Edge (< 20ms away)
 (H.264 4K 50GB)            │         │
      │                     │         ▼
      ▼                     │    Adaptive Bitrate
 Ingest Service ──► S3      │    Streaming Player
      │           (raw)     │    (requests appropriate
      ▼                     │     quality segment)
Transcoding Farm ──────────►│
 (parallel workers)         │
  - 360p @ 500kbps          └─── Origin servers (S3 + CDN origin)
  - 720p @ 2.5Mbps
  - 1080p @ 5Mbps
  - 4K @ 25Mbps
  - Audio: AAC, Dolby Atmos
      │
      ▼
 HLS/DASH manifest + segments
 stored in S3 → CDN
```

The right side of this diagram — CDN edge serving segments directly to viewers — is where nearly all viewer requests land. The origin servers (S3) exist primarily to fill the CDN cache on first access, not to serve ongoing traffic. Getting to a 98% CDN cache hit rate is what makes serving 250 million concurrent streams economically feasible.

## Video Transcoding Pipeline

Transcoding is the most compute-intensive operation in the system, and it must be done before a video can be watched by anyone. A one-hour 4K video encodes into five quality levels plus multiple audio tracks, and each encoding job takes significant CPU time. The solution is to parallelize across many workers simultaneously rather than processing each quality level sequentially on one machine.

```java
// Distributed transcoding: break 1 video into many parallel jobs
@Service
public class VideoTranscodingOrchestrator {

    @Autowired
    private SqsClient sqs;

    @Autowired
    private S3Client s3;

    public void transcodeVideo(VideoUploadedEvent event) {
        String videoId = event.getVideoId();
        String rawS3Key = event.getRawS3Key();

        // Define all required output formats
        List<TranscodeJob> jobs = List.of(
            new TranscodeJob(videoId, "360p",  500_000,  640,  360),
            new TranscodeJob(videoId, "480p",  1_000_000, 854, 480),
            new TranscodeJob(videoId, "720p",  2_500_000, 1280, 720),
            new TranscodeJob(videoId, "1080p", 5_000_000, 1920, 1080),
            new TranscodeJob(videoId, "4k",   25_000_000, 3840, 2160),
            // Audio tracks
            new TranscodeJob(videoId, "audio_aac",   128_000, 0, 0),
            new TranscodeJob(videoId, "audio_dolby", 640_000, 0, 0)
        );

        // Send all jobs to SQS — transcoding workers pick up in parallel
        jobs.forEach(job -> {
            sqs.sendMessage(SendMessageRequest.builder()
                .queueUrl(TRANSCODING_QUEUE_URL)
                .messageBody(serialize(job))
                .messageGroupId(videoId)  // FIFO queue: group by video
                .build());
        });

        // Track completion — send HLS manifest when all renditions done
        jobTracker.initializeVideoTracking(videoId, jobs.size());
    }
}

// FFmpeg-based transcoding worker (runs on EC2 Spot instances — 90% cheaper)
@Component
public class TranscodingWorker {

    @SqsListener(queueNames = "${transcoding.queue.url}")
    public void processJob(TranscodeJob job) {
        // Download raw video chunk from S3
        File rawFile = downloadFromS3(job.getRawS3Key());

        // FFmpeg transcoding
        ProcessBuilder pb = new ProcessBuilder(
            "ffmpeg",
            "-i", rawFile.getAbsolutePath(),
            "-vf", "scale=" + job.getWidth() + ":" + job.getHeight(),
            "-c:v", "libx264",
            "-b:v", job.getBitrate() + "k",
            "-preset", "slow",          // Better compression, slower
            "-crf", "23",               // Quality level
            "-c:a", "aac",
            "-b:a", "128k",
            // HLS segmentation: 6-second segments
            "-f", "hls",
            "-hls_time", "6",
            "-hls_playlist_type", "vod",
            "-hls_segment_filename", outputDir + "/%d.ts",
            outputDir + "/playlist.m3u8"
        );

        executeAndWait(pb);

        // Upload segments and playlist to S3
        uploadSegmentsToS3(outputDir, job.getVideoId(), job.getRendition());

        // Notify orchestrator this rendition is complete
        jobTracker.markComplete(job.getVideoId(), job.getRendition());
    }
}
```

Running transcoding workers on EC2 Spot instances rather than on-demand instances is a 90% cost reduction — and transcoding is a perfect fit for Spot because jobs are interruptible: if a Spot instance is reclaimed, SQS retains the unacknowledged job and another worker picks it up. The `-preset slow` flag in FFmpeg deliberately trades encoding speed for file size: a slower preset produces a smaller output file at the same quality level, which reduces S3 storage costs and CDN bandwidth for every view of the video.

## HLS Manifest: Adaptive Bitrate Streaming

The output of transcoding is not just video files — it is a manifest structure that the player uses to navigate between quality levels on the fly. HLS (HTTP Live Streaming) organizes this into a two-level hierarchy: a master playlist that lists all available quality levels, and per-rendition playlists that list individual 6-second segments.

```
# Master playlist (index.m3u8) — served to player
#EXTM3U
#EXT-X-VERSION:3

# Renditions ordered by bandwidth
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
https://cdn.example.com/videos/abc123/360p/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
https://cdn.example.com/videos/abc123/720p/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
https://cdn.example.com/videos/abc123/1080p/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=25000000,RESOLUTION=3840x2160
https://cdn.example.com/videos/abc123/4k/playlist.m3u8

# 360p playlist (360p/playlist.m3u8)
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD

#EXTINF:6.0,
0.ts
#EXTINF:6.0,
1.ts
...
#EXTINF:4.2,
600.ts
#EXT-X-ENDLIST
```

The HLS player measures download speed. If 1080p segment downloads in 2 seconds but should play in 6 seconds → ample buffer → stay at 1080p. If 1080p segment downloads in 7 seconds but should play in 6 seconds → falling behind → switch to 720p. This adaptation happens every 6 seconds.

The 6-second segment duration is a deliberate engineering choice that balances two competing concerns: shorter segments (2-3 seconds) make quality switching more responsive but increase the number of HTTP requests and add overhead; longer segments (10-15 seconds) reduce HTTP overhead but make quality adaptation sluggish. Six seconds is the sweet spot that most major streaming platforms have converged on.

## CDN Architecture

The CDN is where the "encode once, serve forever" principle pays off. A video segment is a fixed bytes-on-disk file that never changes after encoding, which means it can be cached indefinitely at every CDN edge node worldwide. Once a segment is cached at an edge location, every subsequent request for that segment from that region costs nothing in compute and delivers in under 5ms.

```
Global CDN (CloudFront / Akamai):
  - 400+ edge locations worldwide
  - Video segments cached at edge: 95% cache hit rate
  - Cache hit: 5ms latency
  - Cache miss → origin S3: 50-200ms (once)

Cache key: /videos/{videoId}/{rendition}/{segment}.ts

Cache strategy:
  - Segments: immutable (never change), cache forever (Cache-Control: max-age=31536000)
  - Manifests: short TTL during encoding (5 seconds), long TTL after (1 hour)
  - Playlists: short TTL during live streams, long after VOD is complete
  - Thumbnails: 1 day TTL

CDN hit rate target: 98%
  - Popular videos: 100% (100M+ viewers = every edge has it cached)
  - Long-tail (indie content): 60-80% (less popular = cache misses)
  - First 1% views: always miss (fill the cache)
```

The distinction between `max-age=31536000` (one year) for segments versus a 1-hour TTL for manifests reflects their different mutability: segments are truly immutable and can be cached forever, but manifests may need to be updated if metadata changes or if the encoding pipeline re-processes the video. If you served stale segments it would not matter, but a stale manifest pointing to old segments could break playback.

## Video Start Time Optimization

Start time is the user experience metric that matters most before playback begins. Think of it like launching a rocket: every millisecond of delay before the first frame is felt more acutely than buffering that happens 10 minutes into a show. The optimizations below stack on top of each other, each shaving latency from a different part of the startup sequence.

```
P99 < 2 seconds requires:

1. Fast DNS resolution: Anycast DNS → nearest CDN PoP
   Impact: 50ms → 5ms

2. Video manifest prefetch: when user hovers on thumbnail,
   fetch and cache the master playlist
   Impact: 200ms → 0ms (already cached)

3. Pre-buffered thumbnails: before user clicks play,
   stream still frames (video preview on hover)
   Impact: perceived start time → "instant"

4. Start with lowest quality: request 360p first segment immediately,
   then upgrade quality
   Impact: first frame in 200ms (360p = 375KB), then upgrade

5. ABR algorithm: start low, ramp up quickly
   - First segment: lowest quality (fast start)
   - Next 3 segments: upgrade if bandwidth allows
   - After 30 seconds: stable quality

Start time breakdown:
  DNS lookup: 5ms
  TCP + TLS handshake: 30ms
  Manifest download: 20ms
  First segment download: 100ms (360p, 375KB, 30Mbps)
  Total: 155ms → well under 2 second target
```

The manifest prefetch on hover is worth highlighting as one of the highest-leverage optimizations available: users typically hover over a thumbnail for 200-500ms before clicking, and during that window you can silently fetch the manifest and cache it locally. By the time the user clicks play, the manifest round-trip is already done and the player can immediately request the first segment.

## Recommendation System Architecture

Once a user finishes watching, the next challenge is showing them something they will want to watch next. The recommendation system is a two-stage pipeline designed around a fundamental tradeoff: generating the best possible 5 recommendations from 200 million titles is too slow to do in real time, but doing it entirely in batch misses real-time signals like what the user just watched 10 minutes ago.

```
Data pipeline:
  User events (play, pause, skip, complete, rate) → Kafka → Feature store

Two-stage recommendation:
  Stage 1: Candidate generation (fast, broad)
    - Collaborative filtering: "users like you watched X"
    - Content-based: "you watched thrillers → more thrillers"
    - Trending: popular content in your region
    - Output: 500-1000 candidates per user

  Stage 2: Ranking (slower, precise)
    - Neural network ranking model
    - Features: user history, content metadata, time of day, device
    - Output: top 20 ranked recommendations

Serving:
  - Pre-compute recommendations nightly (batch job)
  - Store in Redis: user_id → [ranked video IDs]
  - Real-time adjustments: boost content just watched by friends
  - A/B test: 20% users get new ranking model vs baseline
```

The two-stage architecture is a pattern you will see throughout large-scale ML systems: a fast, approximate retrieval stage narrows millions of candidates to hundreds, then a slow, precise ranking stage applies a sophisticated model to that smaller set. Trying to run the precise ranking model against all 200 million titles for every user every second would require thousands of GPUs; running it against 500-1000 pre-filtered candidates is economical.

## Storage Cost Optimization

Video storage is where the economics of streaming become genuinely challenging. The numbers below reveal why a naive approach of storing all quality levels for all content is financially unsustainable, and why tiered storage and newer codecs are not just nice-to-haves but existential requirements for the business model.

```
Content stored at multiple quality levels:
  720p (avg 2.5 Mbps, 2hr movie = 2.25GB) × 200M titles = 450 PB
  + 4 more quality levels × 200M titles = 2.25 EB

That's impossibly expensive. Netflix's actual strategy:

1. S3 Intelligent-Tiering:
   - Hot tier (frequently accessed): $0.023/GB/month
   - Cold tier (infrequently accessed, 90+ days): $0.0025/GB/month
   - Long tail content automatically moves to cold tier

2. Per-title quality decision:
   - High-demand titles: store all quality levels at edge
   - Low-demand titles: store only in origin (380p, 720p)
   - Zero-demand titles: transcode on-demand

3. HEVC (H.265) encoding for new content:
   - 40-50% smaller files vs H.264 at same quality
   - Requires hardware decoder (all modern devices support it)

4. AV1 codec (open, royalty-free):
   - 30% smaller than HEVC
   - Google/Netflix co-developed
   - Rolling deployment on supported devices
```

The combination of S3 Intelligent-Tiering and per-title quality decisions means the system is essentially self-optimizing on cost: popular titles migrate to hot-tier storage and get all quality levels at edge CDN, while obscure titles sit in cold storage and are only fetched on the rare occasion someone watches them. A 90% reduction in storage price for cold-tier content changes the math on keeping long-tail content in the catalog at all.

The lessons from video streaming architecture apply broadly: pre-computation beats real-time computation (transcode once, serve forever), geographic distribution beats raw speed (CDN edge beats fast origin), and partial results beat waiting (low quality first, upgrade while playing). These principles show up in recommendation systems, image delivery, web performance — anywhere latency matters more than perfection.
