import { useState, useEffect, useRef } from 'react'
import './index.css'

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [transcription, setTranscription] = useState('')
  const [wsStatus, setWsStatus] = useState('Disconnected')
  
  const wsRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  
  // Connect to WebSocket on mount
  useEffect(() => {
    connectWebSocket()
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])
  
  const connectWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsRef.current = new WebSocket(`${protocol}//${window.location.host}/transcribe`)
    
    wsRef.current.onopen = () => {
      setWsStatus('Connected')
    }
    
    wsRef.current.onmessage = (event) => {
      setTranscription((prev) => prev + event.data)
    }
    
    wsRef.current.onclose = () => {
      setWsStatus('Disconnected')
      // Try to reconnect after 3 seconds
      setTimeout(connectWebSocket, 3000)
    }
    
    wsRef.current.onerror = (error) => {
      console.error('WebSocket Error:', error)
      setWsStatus('Error')
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      
      // Use webm format if supported
      const options = { mimeType: 'audio/webm' };
      const mediaRecorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(options.mimeType) ? options : undefined)
      
      mediaRecorderRef.current = mediaRecorder
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          // Send audio chunk to backend
          wsRef.current.send(event.data)
        }
      }
      
      // Request data every 2 seconds for near real-time streaming
      mediaRecorder.start(2000)
      setIsRecording(true)
      
    } catch (err) {
      console.error("Error accessing microphone:", err)
      alert("Could not access microphone. Please ensure you have granted permission.")
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      streamRef.current.getTracks().forEach(track => track.stop())
      setIsRecording(false)
    }
  }

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  return (
    <>
      <h1>Gemma Transcribe</h1>
      <p className="subtitle">Real-time speech to text powered by Gemma-4-E2B-it</p>
      
      <div className="glass-panel">
        <div className="status-badge">
          <div className={`status-dot ${wsStatus.toLowerCase()}`}></div>
          {wsStatus}
        </div>
        
        <button 
          className={`record-btn ${isRecording ? 'recording' : ''}`}
          onClick={toggleRecording}
          title={isRecording ? "Stop Recording" : "Start Recording"}
        >
          {isRecording ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12"></rect></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
          )}
        </button>
        
        <div className="transcription-box">
          {transcription || <span style={{ opacity: 0.5 }}>Start speaking to see transcription here...</span>}
        </div>
      </div>
    </>
  )
}

export default App
