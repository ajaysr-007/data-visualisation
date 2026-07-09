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

class ChartRequest(BaseModel):
    data: dict | list
    request: str

@app.post("/generate-chart")
async def generate_chart(chart_request: ChartRequest):
    if not api_key:
        raise HTTPException(status_code=500, detail="Azure OpenAI API key not configured")

    system_prompt = """You are a data visualization assistant.

Given JSON data and the user's request, generate ONLY a valid Chart.js configuration object.

Rules:
- Return ONLY JSON.
- No markdown.
- No explanations.
- No code fences.
- Output must be directly parsable by JSON.parse().
- Never return JavaScript.
- Never return text before or after JSON."""

    user_prompt = f"""JSON Data:
{json.dumps(chart_request.data)}

User Request:
{chart_request.request}

Return only the Chart.js configuration JSON."""

    try:
        response = client.chat.completions.create(
            model=deployment_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
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
            chart_config = json.loads(output)
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail=f"Failed to parse model output as JSON. Output was: {output}")

        return {"chartConfig": chart_config}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
