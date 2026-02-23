---
title: "Building AI Agents with Tool Use: From Chatbot to Autonomous Agent"
description: "Build production AI agents using Claude's tool use API. Learn the agentic loop, error handling, multi-step reasoning, human-in-the-loop patterns, and how to build reliable autonomous systems."
date: "2025-03-23"
category: "AI/ML"
tags: ["ai", "agents", "claude", "tool use", "llm", "autonomous systems", "python"]
featured: false
affiliateSection: "ai-ml-books"
---

A chatbot answers questions. An agent takes actions. The difference is tool use: the ability to call functions, search databases, execute code, and interact with external systems. When a model can look up real information, run calculations, and modify state, it transforms from a text generator into a capable assistant. This article builds production-grade agents that actually work.

## The Agentic Loop

Before writing any code, it helps to see the agentic loop in action at the conceptual level. The model does not have all the information it needs to answer a question — instead, it decides what information to fetch, fetches it, and then decides whether it knows enough or needs to take another step. This trace shows that exact reasoning process for a two-step stock comparison question.

```
User request → LLM → Tool call → Execute → Result → LLM → ... → Final answer

Example: "What's the current price of AAPL and how does it compare to last month?"

Turn 1:
  LLM thinks: "I need to get the current AAPL price"
  LLM calls: get_stock_price(ticker="AAPL")
  Tool returns: {"price": 195.42, "timestamp": "2025-03-23T14:30:00Z"}

Turn 2:
  LLM thinks: "Now I need last month's price"
  LLM calls: get_stock_price(ticker="AAPL", date="2025-02-23")
  Tool returns: {"price": 182.15, "timestamp": "2025-02-23T21:00:00Z"}

Turn 3:
  LLM has both values, computes: (195.42 - 182.15) / 182.15 = +7.3%
  LLM answers: "AAPL is currently $195.42, up 7.3% from $182.15 a month ago."
```

## Defining Tools for Claude

The quality of your tool descriptions is just as important as the quality of the tool implementations. The model uses the `description` and `input_schema` fields to decide when and how to call each tool — vague or incomplete descriptions lead to incorrect or missing tool calls. Think of writing a tool definition as writing documentation for a junior developer who can only read the docstring, never the source code.

```python
from anthropic import Anthropic

client = Anthropic()

# Tool definitions: describe capabilities to the model
tools = [
    {
        "name": "get_stock_price",
        "description": "Get the current or historical price of a stock ticker. "
                       "Returns price and timestamp.",
        "input_schema": {
            "type": "object",
            "properties": {
                "ticker": {
                    "type": "string",
                    "description": "Stock ticker symbol (e.g., AAPL, GOOGL, MSFT)"
                },
                "date": {
                    "type": "string",
                    "description": "Date in YYYY-MM-DD format for historical price. "
                                   "Omit for current price."
                }
            },
            "required": ["ticker"]
        }
    },
    {
        "name": "search_web",
        "description": "Search the web for current information. Use when you need "
                       "facts that might be recent or time-sensitive.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query"
                },
                "num_results": {
                    "type": "integer",
                    "description": "Number of results to return (1-10, default 3)"
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "execute_python",
        "description": "Execute Python code and return the output. "
                       "Use for calculations, data processing, or analysis.",
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "Python code to execute"
                }
            },
            "required": ["code"]
        }
    }
]
```

## Tool Execution Layer

With tools defined, you need a layer that routes tool calls to real implementations and handles errors gracefully. Notice the try/except wrapper in `execute` — when a tool fails, you want to return a descriptive error string rather than crash the whole agent. The model will receive that error as the tool result and can decide to retry with different parameters or explain the failure to the user.

```python
import yfinance as yf
import subprocess
import json
from datetime import datetime

class ToolExecutor:
    """Execute tool calls from the model."""

    def execute(self, tool_name: str, tool_input: dict) -> str:
        """Route tool call to the appropriate handler."""
        handlers = {
            "get_stock_price": self._get_stock_price,
            "search_web": self._search_web,
            "execute_python": self._execute_python,
        }

        handler = handlers.get(tool_name)
        if not handler:
            return f"Error: Unknown tool '{tool_name}'"

        try:
            return handler(**tool_input)
        except Exception as e:
            return f"Error executing {tool_name}: {str(e)}"

    def _get_stock_price(self, ticker: str, date: str | None = None) -> str:
        ticker_obj = yf.Ticker(ticker)

        if date:
            hist = ticker_obj.history(start=date, end=date, interval="1d")
            if hist.empty:
                return f"No data found for {ticker} on {date}"
            price = hist["Close"].iloc[-1]
            return json.dumps({"ticker": ticker, "price": round(price, 2), "date": date})
        else:
            info = ticker_obj.info
            price = info.get("currentPrice") or info.get("regularMarketPrice")
            return json.dumps({
                "ticker": ticker,
                "price": price,
                "timestamp": datetime.now().isoformat()
            })

    def _execute_python(self, code: str) -> str:
        """Execute Python in a sandboxed subprocess."""
        # IMPORTANT: In production, use a proper sandbox (Docker, Firecracker)
        # This is a simplified example
        try:
            result = subprocess.run(
                ["python3", "-c", code],
                capture_output=True, text=True, timeout=30,
                # Restrict network access in production
            )
            if result.returncode != 0:
                return f"Error: {result.stderr}"
            return result.stdout.strip()
        except subprocess.TimeoutExpired:
            return "Error: Code execution timed out (30s limit)"
```

## The Agentic Loop Implementation

This is the core of every agent: a loop that calls the model, checks whether it wants to use a tool or give a final answer, executes tools if requested, and feeds results back into the conversation. The `max_turns` guard is not optional — without it, a confused model can loop indefinitely and exhaust your API budget. Every production agent needs a hard ceiling on iterations.

```python
def run_agent(user_message: str, max_turns: int = 10) -> str:
    """
    Run the agentic loop until the model returns a final answer
    or max_turns is reached.
    """
    executor = ToolExecutor()
    messages = [{"role": "user", "content": user_message}]

    for turn in range(max_turns):
        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=4096,
            tools=tools,
            messages=messages
        )

        # Append assistant's response to conversation
        messages.append({"role": "assistant", "content": response.content})

        # Check stop reason
        if response.stop_reason == "end_turn":
            # Model is done — extract and return the text response
            for block in response.content:
                if hasattr(block, "text"):
                    return block.text
            return "No response generated"

        elif response.stop_reason == "tool_use":
            # Model wants to call tools — execute them all
            tool_results = []

            for block in response.content:
                if block.type == "tool_use":
                    print(f"  → Calling {block.name}({block.input})")
                    result = executor.execute(block.name, block.input)
                    print(f"  ← Result: {result[:100]}...")

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result
                    })

            # Return tool results to the model
            messages.append({"role": "user", "content": tool_results})

        else:
            return f"Unexpected stop reason: {response.stop_reason}"

    return "Max turns reached without a final answer"


# Test it
answer = run_agent("What's the market cap of Apple and how does it compare to Microsoft?")
print(answer)
```

The `stop_reason == "tool_use"` branch is where the magic happens: the model pauses its response mid-generation, your code executes the real tool, and the result is injected back into the conversation as if the model had looked it up itself. The model never hallucinates the answer because it never has to — it just asks for what it needs.

## Human-in-the-Loop: Approving Actions

For agents that take real-world actions (send emails, delete files, charge payments), add confirmation steps.

Before you give an agent the ability to take irreversible actions, you need a way to gate those actions behind human approval. The pattern below classifies tools by risk level and automatically approves low-risk reads while requiring explicit confirmation for anything that modifies state or has external effects.

```python
from enum import Enum

class ActionRisk(Enum):
    LOW = "low"       # Read-only, reversible
    MEDIUM = "medium" # Reversible with effort
    HIGH = "high"     # Irreversible, external effects

# Annotate tools with their risk level
TOOL_RISK = {
    "search_web": ActionRisk.LOW,
    "get_stock_price": ActionRisk.LOW,
    "execute_python": ActionRisk.MEDIUM,
    "send_email": ActionRisk.HIGH,
    "delete_file": ActionRisk.HIGH,
    "charge_payment": ActionRisk.HIGH,
}

class SafeToolExecutor:

    def __init__(self, auto_approve_threshold: ActionRisk = ActionRisk.LOW):
        self.auto_approve_threshold = auto_approve_threshold
        self.base_executor = ToolExecutor()

    def execute(self, tool_name: str, tool_input: dict) -> str:
        risk = TOOL_RISK.get(tool_name, ActionRisk.HIGH)

        # Auto-approve low-risk actions
        if risk.value <= self.auto_approve_threshold.value:
            return self.base_executor.execute(tool_name, tool_input)

        # Require human approval for high-risk actions
        approved = self._request_approval(tool_name, tool_input, risk)
        if not approved:
            return f"Action declined by user: {tool_name}"

        return self.base_executor.execute(tool_name, tool_input)

    def _request_approval(self, tool_name: str, tool_input: dict,
                          risk: ActionRisk) -> bool:
        print(f"\n⚠️  [{risk.value.upper()} RISK] Agent wants to: {tool_name}")
        print(f"   Parameters: {json.dumps(tool_input, indent=2)}")
        response = input("Approve? [y/N]: ").strip().lower()
        return response == 'y'
```

The default of `auto_approve_threshold = ActionRisk.LOW` means only reads are automatic — the agent has to ask permission before it executes code or sends anything. In a web application, you would replace the `input()` call with a UI prompt that surfaces in the user's chat window.

## Multi-Agent Orchestration

Complex tasks benefit from specialized sub-agents.

Once your single-agent loop is working, you can compose multiple agents together where each one is focused on a narrow capability. The pattern below separates research (web search) from analysis (computation), with an orchestrator that coordinates the two. This separation means each sub-agent's tool list is small and its instructions are focused, which leads to fewer mistakes than giving one agent every possible tool at once.

```python
class ResearchAgent:
    """Specialized agent for information gathering."""

    def research(self, topic: str) -> str:
        return run_agent(
            f"Research this topic comprehensively: {topic}. "
            "Use web search to find current information. "
            "Return a structured summary with key facts.",
            tools=[web_search_tool]  # Only search tools
        )

class AnalysisAgent:
    """Specialized agent for data analysis."""

    def analyze(self, data: str, question: str) -> str:
        return run_agent(
            f"Analyze this data and answer: {question}\n\nData:\n{data}",
            tools=[execute_python_tool]  # Only computation tools
        )

class OrchestratorAgent:
    """Coordinates research and analysis sub-agents."""

    def __init__(self):
        self.researcher = ResearchAgent()
        self.analyst = AnalysisAgent()

    def answer_complex_question(self, question: str) -> str:
        # Step 1: Research
        print("Phase 1: Researching...")
        research_data = self.researcher.research(question)

        # Step 2: Analyze
        print("Phase 2: Analyzing...")
        analysis = self.analyst.analyze(research_data, question)

        # Step 3: Synthesize
        print("Phase 3: Synthesizing...")
        return client.messages.create(
            model="claude-opus-4-6",
            max_tokens=2048,
            messages=[{
                "role": "user",
                "content": f"Question: {question}\n\n"
                          f"Research findings:\n{research_data}\n\n"
                          f"Analysis:\n{analysis}\n\n"
                          "Provide a comprehensive, well-structured final answer."
            }]
        ).content[0].text
```

## Production Considerations

A working agent in a notebook is very different from a reliable agent in production. You need to handle API failures with retry logic, track costs before they surprise you, and monitor for the failure modes that only appear under real-world usage patterns.

```python
# Error handling and retries
import time

def run_agent_with_retry(user_message: str, max_retries: int = 3) -> str:
    for attempt in range(max_retries):
        try:
            return run_agent(user_message)
        except anthropic.APIStatusError as e:
            if e.status_code == 529 and attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # Exponential backoff
            else:
                raise

# Cost tracking
class CostTrackingAgent:

    def __init__(self):
        self.total_input_tokens = 0
        self.total_output_tokens = 0

    def run(self, message: str) -> str:
        # claude-opus-4-6: $15/MTok input, $75/MTok output
        INPUT_COST_PER_MILLION = 15.0
        OUTPUT_COST_PER_MILLION = 75.0

        result, usage = run_agent_with_usage(message)

        self.total_input_tokens += usage.input_tokens
        self.total_output_tokens += usage.output_tokens

        cost = (usage.input_tokens * INPUT_COST_PER_MILLION / 1_000_000 +
                usage.output_tokens * OUTPUT_COST_PER_MILLION / 1_000_000)

        print(f"Cost: ${cost:.4f} | Total: ${self.total_cost:.4f}")
        return result
```

The exponential backoff in `run_agent_with_retry` is important: `time.sleep(2 ** attempt)` waits 1s, then 2s, then 4s on successive failures. This gives the API time to recover from transient overload without hammering it with immediate retries. The cost tracker is equally important — agentic tasks can consume surprisingly many tokens per turn, and running hundreds of tasks without tracking will produce an unexpected bill.

The key insight for building reliable agents: **the model is not magic**. It will misuse tools, make reasoning errors, and get stuck in loops. Robust agents have: clear tool descriptions (garbage in → garbage out), tool output validation, max turn limits (prevent infinite loops), error handling that feeds back to the model, and human checkpoints for irreversible actions. Build the safeguards before the features.
