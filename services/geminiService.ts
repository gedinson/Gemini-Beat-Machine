

import { GoogleGenAI, Type } from "@google/genai";
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
