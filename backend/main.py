import os
import tempfile
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from transformers import AutoProcessor, AutoModelForMultimodalLM, TextStreamer
import torch
from pydub import AudioSegment

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_ID = "google/gemma-4-E2B-it"

print("Loading model and processor...")
processor = AutoProcessor.from_pretrained(MODEL_ID)
model = AutoModelForMultimodalLM.from_pretrained(
    MODEL_ID,
    device_map="auto"
)
print("Model loaded successfully.")

class WebSocketStreamer(TextStreamer):
    def __init__(self, tokenizer, websocket: WebSocket, **kwargs):
        super().__init__(tokenizer, **kwargs)
        self.websocket = websocket
        self.loop = asyncio.get_event_loop()

    def on_finalized_text(self, text: str, stream_end: bool = False):
        if text:
            asyncio.run_coroutine_threadsafe(self.websocket.send_text(text), self.loop)

@app.websocket("/transcribe")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    streamer = WebSocketStreamer(processor.tokenizer, websocket, skip_prompt=True, skip_special_tokens=True)
    try:
        while True:
            data = await websocket.receive_bytes()
            
            with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_webm:
                temp_webm.write(data)
                temp_webm_path = temp_webm.name

            temp_wav_path = temp_webm_path + ".wav"
            try:
                # Convert webm audio chunk to wav
                audio = AudioSegment.from_file(temp_webm_path)
                audio.export(temp_wav_path, format="wav")
                
                messages = [
                    {
                        "role": "user",
                        "content": [
                            {"type": "audio", "audio": temp_wav_path},
                            {"type": "text", "text": "Transcribe the following speech segment in its original language. Follow these specific instructions for formatting the answer:\n* Only output the transcription, with no newlines.\n* When transcribing numbers, write the digits."},
                        ]
                    }
                ]

                def run_inference():
                    inputs = processor.apply_chat_template(
                        messages,
                        tokenize=True,
                        return_dict=True,
                        return_tensors="pt",
                        add_generation_prompt=True,
                    ).to(model.device)
                    
                    model.generate(
                        **inputs,
                        max_new_tokens=512,
                        streamer=streamer
                    )
                
                await asyncio.to_thread(run_inference)
                # Send space after chunk
                await websocket.send_text(" ")

            except Exception as e:
                print(f"Error processing chunk: {e}")
            finally:
                if os.path.exists(temp_webm_path):
                    os.remove(temp_webm_path)
                if os.path.exists(temp_wav_path):
                    os.remove(temp_wav_path)
            
    except WebSocketDisconnect:
        print("Client disconnected")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
