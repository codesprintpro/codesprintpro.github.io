---
title: "Prompt Engineering: Advanced Techniques for Production LLMs"
description: "Go beyond basic prompting. Learn chain-of-thought reasoning, few-shot examples, structured output, self-consistency, ReAct agents, and evaluation techniques for production LLM applications."
date: "2025-02-26"
category: "AI/ML"
tags: ["ai", "llm", "prompt engineering", "gpt", "claude", "production"]
featured: false
affiliateSection: "ai-ml-books"
---

Most prompt engineering tutorials stop at "be specific and provide context." That's necessary but not sufficient for production systems. This article covers the advanced techniques that separate demos from production-grade LLM applications: structured output, chain-of-thought, self-consistency, and the ReAct framework for agents.

## Mental Model: LLMs as Next-Token Predictors

Every prompt engineering technique becomes intuitive once you internalize this: **an LLM predicts the most probable next token given the context**. This means:

1. The model will continue patterns it sees in the prompt
2. Few-shot examples work because they shift the probability distribution
3. "Think step by step" works because showing the intermediate tokens makes the final answer more probable
4. The model doesn't "understand" your intent — it finds the most statistically likely completion

## Technique 1: Zero-Shot vs Few-Shot

Zero-shot prompting asks the model to perform a task with instructions alone, while few-shot provides concrete examples first. Think of zero-shot as handing someone a job description and asking them to start immediately, versus few-shot as showing them three completed examples of the work before they begin. For simple tasks zero-shot is sufficient, but for nuanced classifications with subtle category distinctions, examples are far more reliable.

### Zero-Shot

```
Prompt: "Classify this email as spam or not spam:
Email: 'Congratulations! You've won $1,000,000. Click here to claim.'
Classification:"

Response: "Spam"
```

### Few-Shot (Better for Complex Classifications)

Notice how each example below covers a distinct scenario — billing, technical, and account issues. You're not just showing the format; you're showing the model the boundaries between categories by example, which is far more effective than trying to describe those boundaries in words.

```
Prompt: "Classify customer support tickets. Categories: BILLING, TECHNICAL, ACCOUNT, GENERAL.

Example 1:
Ticket: "My invoice shows a charge I didn't authorize."
Category: BILLING

Example 2:
Ticket: "The app crashes when I try to export to PDF."
Category: TECHNICAL

Example 3:
Ticket: "I need to transfer my account to a new email address."
Category: ACCOUNT

Now classify:
Ticket: "How do I upgrade my subscription plan?"
Category:"

Response: "BILLING"
```

**Few-shot guidelines:**
- Use 3-8 examples (diminishing returns beyond 8 for most tasks)
- Examples should cover edge cases, not just typical cases
- Maintain consistent format between examples and the query
- Order matters: recent examples have more influence (recency bias)

## Technique 2: Chain-of-Thought (CoT)

CoT dramatically improves reasoning on math, logic, and multi-step problems by showing the model that intermediate reasoning is expected.

The intuition is simple: when you force the model to write out its reasoning step by step, each intermediate conclusion becomes part of the context for the next step. This is why you get correct multi-step answers with CoT that you'd never reliably get from a direct "just tell me the answer" prompt — the intermediate steps guide the model toward the right final token.

```
# Without CoT — often wrong on math
Prompt: "A store sells apples for $0.50 each and oranges for $0.75 each.
If John bought 3 apples and 5 oranges, how much did he spend?"

Response: "$3.25"  # Correct, but unreliable for harder problems

# With CoT — much more reliable
Prompt: "A store sells apples for $0.50 each and oranges for $0.75 each.
If John bought 3 apples and 5 oranges, how much did he spend?

Let's think step by step:"

Response:
"1. Cost of apples: 3 × $0.50 = $1.50
2. Cost of oranges: 5 × $0.75 = $3.75
3. Total: $1.50 + $3.75 = $5.25

John spent $5.25."
```

**Zero-shot CoT trigger phrases** (any of these work):
- "Let's think step by step"
- "Think through this carefully"
- "Reason through each step"
- "Let me work through this"

**Few-shot CoT** — provide examples with explicit reasoning. By showing worked examples, you are training the model's in-context behavior to produce the same style of detailed, step-by-step trace before arriving at an answer.

```python
cot_examples = """
Q: If a train travels 60 mph and needs to cover 150 miles, how long does it take?
A: Let me work through this step by step:
   - Distance = 150 miles
   - Speed = 60 mph
   - Time = Distance / Speed = 150 / 60 = 2.5 hours
   The answer is 2.5 hours (2 hours and 30 minutes).

Q: A recipe calls for 2 cups of flour for 12 cookies.
   How much flour is needed for 30 cookies?
A: Let me work through this step by step:
   - Ratio: 2 cups / 12 cookies = 1/6 cup per cookie
   - For 30 cookies: 30 × (1/6) = 5 cups
   The answer is 5 cups of flour.
"""
```

With few-shot CoT in hand, you have a powerful building block for reliable reasoning. The next challenge is making structured outputs that your application can actually parse.

## Technique 3: Structured Output

Production systems need parseable output, not prose.

When you build a real application around an LLM, you almost always need to extract specific fields from the response — a sentiment score, a list of issues, a priority level. The approach below uses Pydantic models to define the exact schema you expect, which both constrains the model's output and gives you Python objects you can work with directly in your code.

```python
from openai import OpenAI
from pydantic import BaseModel
from typing import Optional
import json

client = OpenAI()

class ProductAnalysis(BaseModel):
    sentiment: str          # "positive" | "negative" | "neutral"
    score: float            # 0.0 to 1.0
    key_issues: list[str]
    recommended_action: str
    priority: str           # "low" | "medium" | "high"

# Method 1: JSON mode (OpenAI)
response = client.chat.completions.create(
    model="gpt-4o",
    response_format={"type": "json_object"},
    messages=[
        {"role": "system", "content": """You are a customer feedback analyst.
        Always respond with valid JSON matching this schema:
        {
          "sentiment": "positive|negative|neutral",
          "score": <float 0-1>,
          "key_issues": [<list of strings>],
          "recommended_action": <string>,
          "priority": "low|medium|high"
        }"""},
        {"role": "user", "content": f"Analyze this review: {review_text}"}
    ]
)
result = ProductAnalysis(**json.loads(response.choices[0].message.content))

# Method 2: Structured outputs (OpenAI, more reliable)
response = client.beta.chat.completions.parse(
    model="gpt-4o-2024-08-06",
    messages=[...],
    response_format=ProductAnalysis,
)
result: ProductAnalysis = response.choices[0].message.parsed
```

Method 2 (structured outputs) is preferred over Method 1 (JSON mode) when available: structured outputs use constrained decoding to guarantee the schema is satisfied at the token level, whereas JSON mode merely requests JSON and can still produce invalid or mismatched structures under edge cases.

**Prompt patterns for structured output:**

```
System: You must respond ONLY with valid JSON. No explanation, no markdown, no prose.
        The JSON must match this exact schema: {...}

User: [Your request]

# Common mistakes:
❌ "Respond in JSON format" — model may wrap in markdown ```json
❌ No schema — model invents fields
✓ Provide exact schema + "ONLY valid JSON" instruction
✓ Use JSON mode or structured outputs API
```

## Technique 4: Self-Consistency

For high-stakes questions, generate multiple responses and take the majority vote. This reduces variance from stochastic generation.

Think of self-consistency like polling multiple experts: any single expert might reason to the wrong conclusion on a hard problem, but if you ask five experts independently and four of them agree, you can be much more confident in that answer. The key is using `temperature > 0` so each sample takes a genuinely different reasoning path.

```python
def self_consistent_answer(question: str, n_samples: int = 5) -> str:
    """Generate n answers with temperature > 0, take majority vote."""

    answers = []
    for _ in range(n_samples):
        response = client.chat.completions.create(
            model="gpt-4o",
            temperature=0.7,  # Non-zero for diversity
            messages=[
                {"role": "system", "content": "Solve this step by step. End with 'Answer: <value>'"},
                {"role": "user", "content": question}
            ]
        )
        text = response.choices[0].message.content
        # Extract final answer
        if "Answer:" in text:
            answer = text.split("Answer:")[-1].strip()
            answers.append(answer)

    # Majority vote
    from collections import Counter
    return Counter(answers).most_common(1)[0][0]

# Best for: math, logic, classification (discrete answers)
# Not useful for: creative writing, open-ended questions
```

**Accuracy improvement (GSM8K math benchmark):**
- GPT-4 zero-shot: 87%
- GPT-4 CoT: 92%
- GPT-4 CoT + self-consistency (n=40): 97%

The 5-point jump from CoT to self-consistency (92% → 97%) comes entirely from running the same prompt multiple times and voting — no additional model capability required. This is a powerful lever when accuracy matters more than cost.

## Technique 5: ReAct — Reasoning + Acting for Agents

ReAct interleaves **Re**asoning and **Act**ing — the model thinks, takes an action (tool call), observes the result, and continues reasoning. This is the backbone of most LLM agents.

The key insight of ReAct is that you don't need to give the model all information upfront. Instead, you give it tools and let it pull in exactly the information it needs, when it needs it. The structured `Thought → Action → Observation` format keeps the reasoning transparent and makes it easy to debug where the agent went wrong.

```
System: You are an assistant that can use tools to answer questions.
Available tools:
- search(query): Search the web
- calculate(expression): Evaluate a math expression
- get_stock_price(ticker): Get current stock price

Think in this format:
Thought: [Your reasoning]
Action: tool_name(arguments)
Observation: [Tool result]
... (repeat as needed)
Final Answer: [Your answer]

User: What is 15% of the current price of AAPL?

Response:
Thought: I need to get the current price of AAPL first, then calculate 15% of it.
Action: get_stock_price(AAPL)
Observation: AAPL current price: $195.42

Thought: Now I'll calculate 15% of $195.42.
Action: calculate(195.42 * 0.15)
Observation: 29.313

Final Answer: 15% of the current AAPL price ($195.42) is approximately $29.31.
```

The implementation below translates this pattern into code. The `stop=["Observation:"]` parameter is the key mechanism: it makes the model halt before writing the observation, so your code can inject the actual tool result rather than letting the model hallucinate one.

```python
# ReAct loop implementation
def react_agent(user_query: str, tools: dict, max_iterations: int = 10) -> str:
    messages = [
        {"role": "system", "content": REACT_SYSTEM_PROMPT},
        {"role": "user", "content": user_query}
    ]

    for iteration in range(max_iterations):
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            stop=["Observation:"]  # Stop before observation to inject tool result
        )

        thought_action = response.choices[0].message.content
        messages.append({"role": "assistant", "content": thought_action})

        if "Final Answer:" in thought_action:
            return thought_action.split("Final Answer:")[-1].strip()

        # Parse and execute action
        if "Action:" in thought_action:
            action_line = [l for l in thought_action.split("\n") if l.startswith("Action:")][0]
            tool_name, args = parse_action(action_line)

            result = tools[tool_name](args)
            observation = f"Observation: {result}\n"
            messages.append({"role": "user", "content": observation})

    return "Max iterations reached"
```

## Technique 6: Prompt Caching

For production systems with expensive prompts, use prompt caching to reduce latency and cost.

When your system prompt contains a large document — a legal contract, a product catalog, a policy manual — you pay embedding cost for that document on every single API call. Prompt caching solves this by storing the KV cache of the processed prompt server-side, so repeated calls reuse the expensive computation instead of redoing it.

```python
# Anthropic Claude: prefix caching
# Mark expensive context (documents, instructions) for caching
response = anthropic.messages.create(
    model="claude-opus-4-6",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": "You are a legal contract analyzer...",
        },
        {
            "type": "text",
            "text": full_contract_text,  # 50,000 tokens — expensive
            "cache_control": {"type": "ephemeral"}  # Cache this for 5 minutes
        }
    ],
    messages=[{"role": "user", "content": "What are the termination clauses?"}]
)
# First call: full cost. Subsequent calls within 5 min: 90% cost reduction
# Cached reads: $0.30/MTok vs write $3.75/MTok (Claude Sonnet)
```

The 90% cost reduction on cache hits makes prompt caching one of the highest-ROI optimizations for production systems that serve many users against a shared, large context. It also reduces latency since the model skips re-processing the cached prefix.

## Evaluation: Measuring Prompt Quality

Building an eval suite is the step most teams skip — and then they wonder why their prompts feel unpredictable. The approach below treats prompt iteration the same way you'd treat code iteration: define expected outputs, measure actual outputs, and only ship changes that improve the metric.

```python
# Build an eval dataset — sample 50-200 real examples
eval_dataset = [
    {
        "input": "This product broke after 2 days",
        "expected": {"sentiment": "negative", "priority": "high"},
    },
    # ...
]

def evaluate_prompt(prompt_template: str, dataset: list) -> dict:
    results = []
    for example in dataset:
        response = run_with_prompt(prompt_template, example["input"])
        results.append({
            "correct": response == example["expected"],
            "latency_ms": response.latency,
            "tokens": response.usage.total_tokens,
        })

    return {
        "accuracy": sum(r["correct"] for r in results) / len(results),
        "avg_latency_ms": sum(r["latency_ms"] for r in results) / len(results),
        "avg_tokens": sum(r["tokens"] for r in results) / len(results),
        "cost_per_1k": sum(r["tokens"] for r in results) / 1000 * TOKEN_PRICE,
    }

# A/B test prompts before shipping to production
baseline = evaluate_prompt(OLD_PROMPT, eval_dataset)
candidate = evaluate_prompt(NEW_PROMPT, eval_dataset)
print(f"Accuracy: {baseline['accuracy']:.1%} → {candidate['accuracy']:.1%}")
```

The highest-leverage prompt engineering investment is building an evaluation suite. Without measurement, you cannot know if a prompt change improves quality or regresses it. Treat prompt changes like code changes — test them before deploying.
