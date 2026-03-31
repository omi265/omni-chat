import { useState, useEffect, useCallback } from 'react';

export const useMediaStream = () => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const startStream = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const message = 'Voice capture is unavailable here. Use HTTPS or localhost to enable microphone access.';
      console.error(message);
      setMediaError(message);
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLocalStream(stream);
      setMediaError(null);
      return stream;
    } catch (err) {
      console.error('Failed to get media stream', err);
      setMediaError('Failed to access your microphone.');
      return null;
    }
  }, []);

  const stopStream = useCallback(() => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
  }, [localStream]);

  const toggleMute = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, [localStream]);

  const toggleDeafen = useCallback(() => {
    setIsDeafened(prev => !prev);
  }, []);

  // Speaking indicator logic
  useEffect(() => {
    if (!localStream || isMuted) {
      setIsSpeaking(false);
      return;
    }

    if (typeof window === 'undefined' || (!window.AudioContext && !(window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)) {
      return;
    }

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(localStream);
    source.connect(analyser);
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let animationFrame: number;
    const checkVolume = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      setIsSpeaking(average > 30); // Threshold for speaking
      animationFrame = requestAnimationFrame(checkVolume);
    };

    checkVolume();

    return () => {
      cancelAnimationFrame(animationFrame);
      audioContext.close();
    };
  }, [localStream, isMuted]);

  return { localStream, startStream, stopStream, toggleMute, toggleDeafen, isMuted, isDeafened, isSpeaking, mediaError };
};
