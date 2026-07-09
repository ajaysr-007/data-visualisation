import os
import json
import uuid
import pandas as pd
# pyrefly: ignore [missing-import]
import duckdb
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import AzureOpenAI

load_dotenv()

app = FastAPI()

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

TEMP_DATA_DIR = "temp_data"
os.makedirs(TEMP_DATA_DIR, exist_ok=True)

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")
    
    session_id = str(uuid.uuid4())
    file_extension = file.filename.split(".")[-1].lower()
    
    try:
        if file_extension == "csv":
            df = pd.read_csv(file.file)
        elif file_extension == "json":
            df = pd.read_json(file.file)
        elif file_extension in ["xls", "xlsx"]:
            df = pd.read_excel(file.file)
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format")
            
        parquet_path = os.path.join(TEMP_DATA_DIR, f"{session_id}.parquet")
        df.to_parquet(parquet_path)
        
        columns = df.dtypes.astype(str).to_dict()
        sample = df.head(3).to_dict(orient="records")
        
        return {
            "session_id": session_id,
            "schema": {
                "columns": columns,
                "sample": sample,
                "row_count": len(df)
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: list[Message]
    session_id: str | None = None

tools = [
    {
        "type": "function",
        "function": {
            "name": "query_database",
            "description": "Execute a DuckDB SQL query to aggregate or filter the current dataset to answer a user's question.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string", "description": "The DuckDB SQL query string. Must be a SELECT statement."}
                },
                "required": ["sql"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "render_chart",
            "description": "Create a visualization. Call this when the user asks for a chart. If no active dataset exists, use the raw_data parameter instead of sql. CALL THIS MULTIPLE TIMES IN A SINGLE RESPONSE to generate a dashboard.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string", "description": "DuckDB SQL query to get data. Use ONLY if an active dataset is provided."},
                    "raw_data": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": "Raw JSON array of objects. Use this ONLY if the user provided data in their chat message."
                    },
                    "chart_type": {"type": "string", "enum": ["bar", "line", "pie", "doughnut", "radar", "polarArea"]},
                    "labels_column": {"type": "string", "description": "Column name or JSON key to use for X-axis labels"},
                    "data_columns": {
                        "type": "array", 
                        "items": {
                            "type": "object", 
                            "properties": {
                                "label": {"type": "string", "description": "Display name of the dataset for the legend"},
                                "column": {"type": "string", "description": "Column name or JSON key containing numerical data"}
                            },
                            "required": ["label", "column"]
                        }
                    }
                },
                "required": ["chart_type", "labels_column", "data_columns"]
            }
        }
    }
]

@app.post("/generate-chart")
async def generate_chart(chat_request: ChatRequest):
    if not api_key:
        raise HTTPException(status_code=500, detail="Azure OpenAI API key not configured")

    dataset_context = ""
    parquet_path = None
    if chat_request.session_id:
        parquet_path = os.path.join(TEMP_DATA_DIR, f"{chat_request.session_id}.parquet")
        if os.path.exists(parquet_path):
            conn = duckdb.connect()
            try:
                schema_df = conn.execute(f"DESCRIBE SELECT * FROM '{parquet_path}'").df()
                columns_info = schema_df[['column_name', 'column_type']].to_dict('records')
                dataset_context = f"\n\nActive Dataset Available:\n- Table Name: '{parquet_path}'\n- Schema: {json.dumps(columns_info)}\nAlways use this exact table name in your SQL queries. You must use the 'sql' parameter when calling tools."
            finally:
                conn.close()

    if not dataset_context:
        dataset_context = "\n\nNo active dataset is currently uploaded. If the user provides raw JSON data in the chat and asks for a chart, you MUST aggregate and calculate the final plotting data yourself, and pass that AGGREGATED data into the 'raw_data' parameter of the 'render_chart' tool. Ensure the keys in 'raw_data' exactly match what you specify in 'labels_column' and 'data_columns'."

    system_prompt = f"""You are an AI data visualization assistant and data engineer. You can converse naturally with the user.
{dataset_context}

CRITICAL DASHBOARD RULE: Whenever a user provides data and asks you to visualize it or create a chart, DO NOT ask them what type of chart they want. Instead, YOU MUST automatically generate a comprehensive dashboard of 4 to 5 DIFFERENT charts (e.g. bar, pie, doughnut, polarArea) by calling the `render_chart` tool multiple times consecutively in your response. Each chart should highlight a different slice or perspective of the data.

When answering data questions, ALWAYS use the 'query_database' tool to get the factual numbers before answering (if a dataset is uploaded).
"""

    messages = [{"role": "system", "content": system_prompt}]
    for m in chat_request.messages:
        messages.append({"role": m.role, "content": m.content})

    final_chart_configs = []
    max_loops = 5
    loop_count = 0

    while loop_count < max_loops:
        loop_count += 1
        
        response = client.chat.completions.create(
            model=deployment_name,
            messages=messages,
            tools=tools,
            temperature=0,
        )
        
        response_message = response.choices[0].message
        
        if response_message.tool_calls:
            tool_calls_dict = []
            for tc in response_message.tool_calls:
                tool_calls_dict.append({
                    "id": tc.id,
                    "type": tc.type,
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments
                    }
                })
            
            messages.append({
                "role": "assistant",
                "content": response_message.content,
                "tool_calls": tool_calls_dict
            })
            
            for tool_call in response_message.tool_calls:
                function_name = tool_call.function.name
                args = json.loads(tool_call.function.arguments)
                
                tool_result = ""
                
                if function_name in ["query_database", "render_chart"]:
                    sql = args.get("sql")
                    raw_data = args.get("raw_data")
                    
                    try:
                        result_df = None
                        if sql and parquet_path and os.path.exists(parquet_path):
                            conn = duckdb.connect()
                            try:
                                result_df = conn.execute(sql).df()
                            finally:
                                conn.close()
                        elif raw_data:
                            result_df = pd.DataFrame(raw_data)
                        elif sql:
                            raise Exception("You provided SQL but there is no active dataset uploaded. Please ask the user to upload a file or provide raw data.")
                        else:
                            raise Exception("You must provide either 'sql' (for uploaded files) or 'raw_data' (for text data).")
                        
                        if function_name == "query_database":
                            tool_result = result_df.to_json(orient="records")
                            
                        elif function_name == "render_chart":
                            chart_type = args.get("chart_type", "bar")
                            labels_column = args.get("labels_column")
                            data_columns = args.get("data_columns", [])
                            
                            if labels_column not in result_df.columns:
                                raise Exception(f"labels_column '{labels_column}' not found. Available columns: {list(result_df.columns)}")
                            labels = [None if pd.isna(x) else x for x in result_df[labels_column].tolist()]
                            
                            bg_colors = [
                                'rgba(99, 102, 241, 0.8)',
                                'rgba(236, 72, 153, 0.8)',
                                'rgba(16, 185, 129, 0.8)',
                                'rgba(245, 158, 11, 0.8)',
                                'rgba(139, 92, 246, 0.8)',
                            ]
                            
                            datasets = []
                            for i, dc in enumerate(data_columns):
                                col_name = dc.get("column")
                                if col_name not in result_df.columns:
                                    raise Exception(f"data_column '{col_name}' not found. Available columns: {list(result_df.columns)}")
                                
                                data_list = [None if pd.isna(x) else x for x in result_df[col_name].tolist()]
                                
                                if chart_type in ["pie", "doughnut", "polarArea"]:
                                    color = [bg_colors[j % len(bg_colors)] for j in range(len(data_list))]
                                    border_color = [c.replace('0.8', '1') for c in color]
                                else:
                                    color = bg_colors[i % len(bg_colors)]
                                    border_color = color.replace('0.8', '1')
                                
                                ds = {
                                    "label": dc.get("label", col_name),
                                    "data": data_list,
                                    "backgroundColor": color,
                                    "borderColor": border_color,
                                    "borderWidth": 1,
                                    "borderRadius": 8 if chart_type == "bar" else 0,
                                    "tension": 0.4 if chart_type in ["line", "radar"] else 0,
                                    "fill": True if chart_type in ["line", "radar"] else False
                                }
                                datasets.append(ds)
                            
                            chart_config = {
                                "type": chart_type,
                                "data": {
                                    "labels": labels,
                                    "datasets": datasets
                                },
                                "options": {
                                    "responsive": True,
                                    "maintainAspectRatio": False,
                                    "plugins": {
                                        "legend": {"position": "top"},
                                        "tooltip": {
                                            "backgroundColor": "rgba(15, 23, 42, 0.9)",
                                            "titleFont": {"size": 14},
                                            "bodyFont": {"size": 13},
                                            "padding": 12,
                                            "cornerRadius": 8
                                        }
                                    }
                                }
                            }
                            
                            final_chart_configs.append(chart_config)
                            tool_result = f"Successfully rendered {chart_type} chart."
                            
                    except Exception as e:
                        tool_result = f"Error generating data: {str(e)}"
                else:
                    tool_result = "Unknown tool"
                
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": function_name,
                    "content": tool_result
                })
        else:
            final_text = response_message.content
            return {"message": final_text, "chartConfigs": final_chart_configs}
            
    return {"message": "Reached maximum processing steps.", "chartConfigs": final_chart_configs}
