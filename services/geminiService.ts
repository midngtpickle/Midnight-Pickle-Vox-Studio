import { GoogleGenAI } from "@google/genai";
import { VoiceName } from '../types';

let genAI: GoogleGenAI | null = null;

const getGenAI = () => {
  if (!genAI) {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.error("API_KEY not found in environment variables");
    }
    genAI = new GoogleGenAI({ apiKey: apiKey || '' });
  }
  return genAI;
};

export const generateSpeech = async (
  text: string,
  style: string,
  voice: VoiceName
): Promise<string> => {
  const ai = getGenAI();
  const model = "gemini-3.1-flash-tts-preview";

  const cleanText = text.trim();
  const cleanStyle = style.trim();
  
  // Construct the prompt.
  // The model supports "Say [Style]: [Text]" format for stylized speech.
  const promptText = cleanStyle 
    ? `Say ${cleanStyle}: ${cleanText}`
    : cleanText;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: [{ parts: [{ text: promptText }] }],
      config: {
        // Use string literal 'AUDIO' explicitly to avoid runtime enum import issues (Modality.AUDIO)
        responseModalities: ['AUDIO'] as any,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const candidate = response.candidates?.[0];

    // Check for explicit failure reasons from the model
    if (candidate?.finishReason) {
      if (candidate.finishReason === 'SAFETY') {
        throw new Error("Speech generation blocked by safety filters.");
      }
      if (candidate.finishReason === 'OTHER') {
        // 'OTHER' typically indicates a configuration mismatch or internal model processing failure
        console.error("Gemini FinishReason: OTHER", JSON.stringify(candidate, null, 2));
        throw new Error("The model was unable to generate speech (FinishReason: OTHER). Please try a different text or style.");
      }
      // If finishReason is not STOP (and not undefined/null), it might be an issue
      if (candidate.finishReason !== 'STOP') {
         console.warn(`Unexpected finish reason: ${candidate.finishReason}`);
      }
    }

    const parts = candidate?.content?.parts;
    const audioPart = parts?.find(p => p.inlineData && p.inlineData.data);

    if (!audioPart || !audioPart.inlineData?.data) {
       console.error("Unexpected response structure (No audio data):", JSON.stringify(response, null, 2));
       throw new Error("Gemini returned a response but no audio data was found.");
    }

    return audioPart.inlineData.data;

  } catch (error) {
    console.error("Gemini TTS Error:", error);
    throw error;
  }
};