import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import AzureOpenAI

load_dotenv()

app = FastAPI()

# Allow CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
api_key = os.getenv("AZURE_OPENAI_API_KEY")
api_version = os.getenv("AZURE_OPENAI_API_VERSION")
deployment_name = os.getenv("AZURE_OPENAI_DEPLOYMENT")

client = AzureOpenAI(
    azure_endpoint=azure_endpoint,
    api_key=api_key,
    api_version=api_version
)

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: list[Message]

@app.post("/generate-chart")
async def generate_chart(chat_request: ChatRequest):
    if not api_key:
        raise HTTPException(status_code=500, detail="Azure OpenAI API key not configured")

    system_prompt = """You are an AI data visualization assistant.
Respond to the user's requests in JSON format containing two keys: "message" (a string for your conversational text response) and "chartConfig" (a valid Chart.js configuration object, or null if you don't need to render a chart).

Rules:
- Return ONLY JSON.
- No markdown code fences.
- Output must be directly parsable by JSON.parse().
- Never return JavaScript code.
- If the user provides data and asks for a chart, respond naturally in "message" and provide the Chart.js config in "chartConfig".
- If no chart is needed, set "chartConfig" to null."""

    try:
        messages = [{"role": "system", "content": system_prompt}]
        for m in chat_request.messages:
            messages.append({"role": m.role, "content": m.content})

        response = client.chat.completions.create(
            model=deployment_name,
            messages=messages,
            temperature=0,
        )
        
        output = response.choices[0].message.content.strip()
        
        # Strip potential markdown code fences if the model still adds them
        if output.startswith("```json"):
            output = output[7:]
        if output.startswith("```"):
            output = output[3:]
        if output.endswith("```"):
            output = output[:-3]
        
        output = output.strip()

        try:
            parsed_output = json.loads(output)
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail=f"Failed to parse model output as JSON. Output was: {output}")

        return parsed_output

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
