---
title: "Fine-Tuning LLMs: When to Fine-Tune, When to Prompt"
description: "Decide when fine-tuning beats prompt engineering, how to prepare training data, run LoRA fine-tuning efficiently, and evaluate model quality. Covers OpenAI fine-tuning and open-source with Hugging Face."
date: "2025-03-27"
category: "AI/ML"
tags: ["ai", "llm", "fine-tuning", "lora", "hugging face", "openai", "machine learning"]
featured: false
affiliateSection: "ai-ml-books"
---

Fine-tuning is often the wrong choice. Most problems that engineers reach for fine-tuning to solve are better solved with better prompt engineering, few-shot examples, or RAG. But when you genuinely need fine-tuning — for style consistency, domain-specific knowledge not in training data, or latency reduction — it's transformative. This article helps you make the right choice and do the fine-tuning correctly.

## When Fine-Tuning is the Wrong Choice

Before spending days preparing data and dollars on GPU time, work through this decision tree. The examples below show the most common fine-tuning mistakes — each one has a simpler, cheaper solution that most engineers overlook because fine-tuning feels like the "serious" approach.

```
Problem: "The model doesn't know our internal coding conventions"
Wrong answer: Fine-tune
Right answer: Add coding conventions to the system prompt
              Or create a few-shot example template

Problem: "The model doesn't know our product documentation"
Wrong answer: Fine-tune (your docs won't fit in training anyway)
Right answer: RAG — embed docs, retrieve relevant chunks at query time

Problem: "The model sometimes doesn't follow the output format"
Wrong answer: Fine-tune on format examples
Right answer: Use structured outputs (JSON mode) or better prompt instructions

Problem: "I want a cheaper, faster model"
Wrong answer: Fine-tune GPT-4 (won't make it cheaper)
Right answer: Distillation — generate training data from GPT-4,
              fine-tune GPT-4o-mini on that data
              (can get GPT-4 quality at GPT-4o-mini price for specific tasks)
```

## When Fine-Tuning IS the Right Choice

With the anti-patterns clear, here are the scenarios where fine-tuning genuinely outperforms alternatives. The common thread across all of them is that you have a well-defined, high-volume, repeatable task where the investment in training data pays off over thousands or millions of inferences.

```
✓ Consistent style/tone at scale
  - Customer service bot that must always match brand voice
  - Code generation in company-specific patterns
  - Technical writing with domain-specific terminology

✓ Short, repetitive prompts → latency reduction
  - System prompt has 10,000 tokens → adds 500ms per call
  - Fine-tuning "bakes in" the instructions → 100-token system prompt
  - Result: 80% latency reduction for same quality

✓ Specialized domain not in base training
  - Medical codes (ICD-10, CPT) with specific formatting rules
  - Legal document classification with jurisdiction-specific standards
  - Proprietary data formats (your company's SQL dialect)

✓ Distillation (most common good use case)
  - Use expensive GPT-4 to generate 1,000 high-quality examples
  - Fine-tune cheap GPT-4o-mini on those examples
  - Get 90% of GPT-4 quality at 10% of GPT-4 cost for your specific task
```

## Data Preparation: The Most Important Step

Fine-tuning quality is almost entirely determined by data quality. 500 excellent examples beat 5,000 mediocre ones.

Your training examples are the blueprint the model learns from — if your examples have inconsistent tone, vary in format, or include sloppy responses, the model will learn those patterns faithfully. The gold standard is examples that represent exactly the behavior you want the model to exhibit at inference time, written by the person or team with the deepest knowledge of what "good" looks like for your use case.

```python
# Training data format for chat fine-tuning (OpenAI compatible)
training_examples = [
    {
        "messages": [
            {
                "role": "system",
                "content": "You are a customer support agent for TechCorp. "
                           "Always be concise, empathetic, and offer concrete next steps."
            },
            {
                "role": "user",
                "content": "My order hasn't arrived and it's been 10 days"
            },
            {
                "role": "assistant",
                "content": "I'm sorry for the delay — 10 days is longer than expected. "
                           "I've checked your order #TC-123456 and can see it's still in transit. "
                           "I'll escalate this to our shipping team and you'll receive an update "
                           "within 4 hours. Would you like me to also initiate a replacement shipment?"
            }
        ]
    },
    # ... 499 more examples
]

# Save in JSONL format (one JSON object per line)
import json
with open("training_data.jsonl", "w") as f:
    for example in training_examples:
        f.write(json.dumps(example) + "\n")
```

Notice the structure: each example has a system prompt that defines the persona, a realistic user message, and an ideal assistant response. The system prompt is the same across all examples because you want the model to internalize that persona — if you vary the system prompt per example, the model learns multiple conflicting behaviors.

Running the validation script below before submitting your training job will catch the common issues that silently degrade fine-tune quality, such as missing assistant turns or responses that are too short to teach the model anything useful.

```python
# Data quality checklist script
def validate_training_data(filepath: str) -> dict:
    issues = []
    examples = []

    with open(filepath) as f:
        for i, line in enumerate(f):
            try:
                example = json.loads(line)
                examples.append(example)
            except json.JSONDecodeError as e:
                issues.append(f"Line {i+1}: Invalid JSON: {e}")

    # Check for common issues
    for i, example in enumerate(examples):
        messages = example.get("messages", [])

        # Check: has system, user, and assistant
        roles = [m["role"] for m in messages]
        if "assistant" not in roles:
            issues.append(f"Example {i+1}: Missing assistant message")

        # Check: assistant response length distribution
        for m in messages:
            if m["role"] == "assistant":
                if len(m["content"]) < 10:
                    issues.append(f"Example {i+1}: Very short assistant response")
                if len(m["content"]) > 2000:
                    issues.append(f"Example {i+1}: Very long assistant response (fine-tuning works best on focused, shorter outputs)")

    # Token count estimate
    total_tokens = sum(
        sum(len(m["content"].split()) * 1.3 for m in ex["messages"])  # rough estimate
        for ex in examples
    )

    return {
        "total_examples": len(examples),
        "issues": issues,
        "estimated_tokens": int(total_tokens),
        "estimated_cost_usd": total_tokens / 1_000_000 * 8  # GPT-4o-mini: ~$8/M tokens for training
    }

report = validate_training_data("training_data.jsonl")
print(f"Examples: {report['total_examples']}")
print(f"Issues: {len(report['issues'])}")
print(f"Estimated training cost: ${report['estimated_cost_usd']:.2f}")
```

The estimated cost output lets you make a go/no-go decision before spending money. For most tasks, a 500-example dataset with typical response lengths costs well under $10 to train on GPT-4o-mini — the data preparation effort is the real cost, not the compute.

## OpenAI Fine-Tuning

With your data validated, the OpenAI fine-tuning API makes the actual training a four-step process: upload your file, create a job, monitor until completion, and deploy the resulting model. The polling loop below is important — training can take anywhere from minutes to hours depending on dataset size, and you need to handle both success and failure gracefully.

```python
from openai import OpenAI

client = OpenAI()

# Step 1: Upload training file
with open("training_data.jsonl", "rb") as f:
    file = client.files.create(file=f, purpose="fine-tune")

print(f"File ID: {file.id}")

# Step 2: Create fine-tuning job
job = client.fine_tuning.jobs.create(
    training_file=file.id,
    model="gpt-4o-mini-2024-07-18",  # Base model to fine-tune
    hyperparameters={
        "n_epochs": 3,              # 3-10 typically; more = risk of overfitting
        "batch_size": "auto",       # Let OpenAI optimize
        "learning_rate_multiplier": "auto"
    },
    suffix="customer-support-v1"    # Your fine-tuned model name suffix
)

print(f"Job ID: {job.id}")

# Step 3: Monitor progress
import time

while True:
    job = client.fine_tuning.jobs.retrieve(job.id)
    print(f"Status: {job.status}, events: {len(job.integrations)}")

    if job.status in ("succeeded", "failed", "cancelled"):
        break
    time.sleep(60)

if job.status == "succeeded":
    model_id = job.fine_tuned_model
    print(f"Fine-tuned model: {model_id}")
    # e.g., "ft:gpt-4o-mini-2024-07-18:your-org:customer-support-v1:abc123"

# Step 4: Use the fine-tuned model
response = client.chat.completions.create(
    model=model_id,
    messages=[
        {"role": "user", "content": "My subscription charge looks wrong"}
    ]
)
print(response.choices[0].message.content)
```

The `n_epochs` hyperparameter controls how many times the model sees your entire dataset during training. With 3 epochs and 500 examples, the model sees each example 3 times — enough to learn the pattern without memorizing individual responses. If you see the fine-tuned model producing verbatim copies of training examples on similar inputs, that is a sign of overfitting and you should reduce epochs or increase dataset diversity.

## Open-Source: LoRA Fine-Tuning with Hugging Face

For open-source models (Llama, Mistral, Qwen), LoRA (Low-Rank Adaptation) fine-tunes efficiently on consumer hardware.

Full fine-tuning of an 8B parameter model would require updating all 8 billion weights — computationally prohibitive without expensive server-grade GPUs. LoRA solves this elegantly: instead of modifying the original weights, it adds small "adapter" matrices alongside specific layers and only trains those. The original model is frozen, and only the adapters (about 0.1% of total parameters) are updated.

```python
# pip install transformers peft datasets trl accelerate bitsandbytes
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model, TaskType
from trl import SFTTrainer
from datasets import Dataset

# Load base model in 4-bit quantization (fits in 8GB VRAM)
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_compute_dtype="float16",
    bnb_4bit_quant_type="nf4",
    bnb_4bit_use_double_quant=True,
)

model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3.1-8B-Instruct",
    quantization_config=bnb_config,
    device_map="auto",
)
tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B-Instruct")

# LoRA configuration: only fine-tune small adapters
# Adapts 0.1-1% of parameters vs 100% for full fine-tuning
lora_config = LoraConfig(
    r=16,                           # Rank: higher = more expressive, more memory
    lora_alpha=32,                  # Scaling factor (typically 2×r)
    target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],  # Which layers to adapt
    lora_dropout=0.05,
    task_type=TaskType.CAUSAL_LM
)

model = get_peft_model(model, lora_config)
model.print_trainable_parameters()
# trainable params: 6,815,744 || all params: 8,036,065,280 || trainable: 0.085%

# Train
trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=Dataset.from_json("training_data.jsonl"),
    max_seq_length=2048,
    dataset_text_field="text",
    peft_config=lora_config,
    args=TrainingArguments(
        output_dir="./fine-tuned-model",
        num_train_epochs=3,
        per_device_train_batch_size=4,
        gradient_accumulation_steps=2,
        warmup_ratio=0.1,
        learning_rate=2e-4,
        fp16=True,
        logging_steps=10,
        save_strategy="epoch",
    )
)

trainer.train()
trainer.save_model("./fine-tuned-model")
```

The `print_trainable_parameters()` output confirms the LoRA efficiency: only 6.8M parameters are trained out of 8B total — about 0.085%. This is why LoRA fits in 8GB VRAM where full fine-tuning would need 80GB or more. The `r=16` rank parameter is the primary knob controlling the adapter expressiveness; start here and only increase if the fine-tuned model underfits your task.

## Evaluating Fine-Tuned Models

No fine-tuning project is complete without a rigorous evaluation against a held-out test set. The evaluation code below runs both the base model and your fine-tuned model against the same examples and compares scores side by side — this is the only way to confirm that your fine-tuning actually improved the behavior you cared about rather than introducing regressions elsewhere.

```python
# Build an evaluation set (separate from training data!)
# 10-20% of your data, never seen during training
eval_examples = load_eval_set("eval_data.jsonl")

def evaluate_model(model_id: str, eval_set: list) -> dict:
    results = []

    for example in eval_set:
        user_message = example["messages"][-2]["content"]  # User turn
        expected = example["messages"][-1]["content"]       # Expected assistant response

        # Generate response
        response = client.chat.completions.create(
            model=model_id,
            messages=[m for m in example["messages"][:-1]]  # All but last
        )
        actual = response.choices[0].message.content

        # Score: use LLM-as-judge for open-ended quality
        score = llm_judge_score(expected=expected, actual=actual)
        results.append({"score": score, "expected": expected, "actual": actual})

    return {
        "mean_score": sum(r["score"] for r in results) / len(results),
        "worst_examples": sorted(results, key=lambda x: x["score"])[:5]
    }

# Compare base model vs fine-tuned
base_eval = evaluate_model("gpt-4o-mini-2024-07-18", eval_examples)
ft_eval = evaluate_model(fine_tuned_model_id, eval_examples)

print(f"Base model score: {base_eval['mean_score']:.2%}")
print(f"Fine-tuned score: {ft_eval['mean_score']:.2%}")
# Target: fine-tuned should be 15-30% better for your specific task
```

The `worst_examples` output is as valuable as the mean score. Reviewing the five lowest-scoring responses reveals patterns in where your model still fails — whether that is a missing edge case in your training data, a formatting inconsistency, or a category of user input that your training examples never covered. Fix those gaps and retrain rather than shipping a model you have not stress-tested.

The decision tree for LLM customization: start with prompt engineering (free, instant). If quality is insufficient after careful prompt iteration, try RAG (if the issue is missing knowledge). If style/format is the issue and prompts aren't working, try few-shot examples in the prompt. Only if all of the above fail for a well-defined, high-volume task does fine-tuning become worthwhile. The data preparation and evaluation infrastructure is the real investment — the actual fine-tuning is the easy part.
