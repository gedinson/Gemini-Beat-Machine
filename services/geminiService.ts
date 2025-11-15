

import { GoogleGenAI, Type, Modality, GenerateContentResponse, Chat } from "@google/genai";
import { BeatPattern, Instrument } from "../types";
import { INSTRUMENTS, NUM_STEPS } from '../constants';

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

const beatGenerationSchema = {
    type: Type.OBJECT,
    properties: INSTRUMENTS.reduce((acc, inst) => {
        acc[inst] = {
            type: Type.ARRAY,
            description: `An array of 32 numbers (0 or 1) for the ${inst} track.`,
            items: { type: Type.INTEGER }
        };
        return acc;
    }, {} as Record<string, any>),
};

export const generateBeatPattern = async (prompt: string): Promise<BeatPattern | null> => {
    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: "gemini-2.5-pro",
            contents: prompt,
            config: {
                systemInstruction: `You are an expert drum machine programmer. Your task is to generate a 32-step drum pattern based on a user's request. You must respond with only a valid JSON object matching the provided schema. The JSON object should have keys for some or all of the following instruments: ${INSTRUMENTS.join(', ')}. The value for each key must be an array of 32 numbers, where 1 represents an active step (a hit) and 0 represents an inactive step. Do not include any other text, explanations, or markdown formatting in your response.`,
                responseMimeType: "application/json",
                responseSchema: beatGenerationSchema,
            },
        });
        const jsonText = response.text;
        const parsed = JSON.parse(jsonText) as BeatPattern;
        return parsed;
    } catch (error) {
        console.error("Error generating beat pattern:", error);
        return null;
    }
};

export const searchMusicInfo = async (query: string) => {
    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: query,
            config: {
                tools: [{ googleSearch: {} }],
            },
        });
        const text = response.text;
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        return { text, groundingChunks };
    } catch (error) {
        console.error("Error with Google Search grounding:", error);
        return { text: "Sorry, I couldn't fetch that information.", groundingChunks: [] };
    }
};

export const generateSpeech = async (text: string): Promise<string | null> => {
    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' },
                    },
                },
            },
        });
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        return base64Audio || null;
    } catch (error) {
        console.error("Error generating speech:", error);
        return null;
    }
};

export const editImage = async (prompt: string, base64ImageData: string, mimeType: string): Promise<string | null> => {
    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [
                    { inlineData: { data: base64ImageData, mimeType: mimeType } },
                    { text: prompt },
                ],
            },
            config: {
                responseModalities: [Modality.IMAGE],
            },
        });
        const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        return part?.inlineData?.data || null;
    } catch (error) {
        console.error("Error editing image:", error);
        return null;
    }
};

export const animateImage = async (prompt: string, base64ImageData: string, mimeType: string, aspectRatio: '16:9' | '9:16') => {
    const ai = getAI();
    let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt,
        image: { imageBytes: base64ImageData, mimeType },
        config: {
            numberOfVideos: 1,
            resolution: '720p',
            aspectRatio: aspectRatio,
        }
    });

    while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) {
        throw new Error("Video generation failed or returned no link.");
    }
    const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
    const videoBlob = await response.blob();
    return URL.createObjectURL(videoBlob);
};