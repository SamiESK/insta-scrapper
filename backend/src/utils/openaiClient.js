/**
 * OpenAI Client for generating outreach messages
 */

import OpenAI from 'openai';
import { logger } from './logger.js';
import { config } from '../config/env.js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY || process.env.OPENAI_API_KEY
});

/**
 * Generate an outreach message using OpenAI API with a prompt ID
 * Sends a simple message to the prompt ID and returns the exact response
 * @param {string} promptId - The OpenAI prompt ID (e.g., "pmpt_691521bcde108196b23a222e5df68b1b07b150b88830da70")
 * @param {string} username - The Instagram username to send message to (optional, for context)
 * @returns {Promise<string>} Generated outreach message (exact response from the prompt ID)
 */

export async function generateOutreachMessage(promptId, username = null) {
  try {
    if (!openai.apiKey) {
      throw new Error('OpenAI API key is not configured');
    }

    if (!promptId || promptId.trim() === '') {
      throw new Error('Prompt ID is required and cannot be empty');
    }

    logger.info(`=== OPENAI MESSAGE GENERATION ===`);
    logger.info(`Prompt ID: ${promptId}`);
    logger.info(`Username: ${username || 'N/A'}`);

    // Use Chat Completions API with EXTREMELY STRICT system message
    // The prompt ID is used as a reference identifier
    const systemMessage = `You are an outreach message generator. Your ONLY job is to return the message text itself.

ABSOLUTE REQUIREMENTS:
1. Return ONLY the message text - nothing else
2. Start immediately with the greeting (e.g., "Hello," or "Hi," or "I'm with...")
3. NO "Subject:" lines
4. NO "Sure!" or "Here's a message:" 
5. NO explanations or meta-text
6. NO placeholders like [Your Name]
7. NO email formatting
8. Just the message text, ready to send

Example of CORRECT output:
"Hello, I'm with the @Clips team on Instagram (14M followers). We're interested in reposting your recent video. If you'd like to take part, please use the link in our IG bio to submit it."

Example of WRONG output:
"Subject: Collaboration Opportunity
Hi Campbell! Here's a message you can use..."

Return ONLY the message text starting with the greeting.`;

    const userMessage = 'Send this content creator a outreach message';

    logger.info(`Using Chat Completions API with prompt ID: ${promptId}`);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemMessage
        },
        {
          role: 'user',
          content: userMessage
        }
      ],
      temperature: 0.7,
      max_tokens: 200
    });

    logger.info(`OpenAI API Response received`);

    let message = response.choices?.[0]?.message?.content || '';

    if (!message) {
      logger.warn('OpenAI response structure:', JSON.stringify(response, null, 2));
      throw new Error('No message generated from OpenAI - check response structure');
    }

    logger.info(`Raw message from OpenAI (${message.length} chars): ${message.substring(0, 150)}...`);

    // NUCLEAR cleaning - remove EVERYTHING that's not the actual message
    message = message.trim();
    
    // Step 1: Remove "Subject:" lines completely (including multi-line subjects)
    message = message.replace(/^Subject:\s*[^\n]+\n?/gi, '');
    message = message.replace(/Subject:\s*[^\n]+/gi, '');
    
    // Step 2: Find the FIRST occurrence of actual message content
    // Look for patterns that indicate the real message starts
    const realMessageStarters = [
      /(?:^|\n)\s*(Hi|Hello|Hey|Greetings)[\s,]/i,
      /(?:^|\n)\s*(I'?m|We'?re|I'?ve)/i,
      /(?:^|\n)\s*Hello, I'?m with/i,
    ];
    
    let foundStart = false;
    for (const pattern of realMessageStarters) {
      const match = message.match(pattern);
      if (match && match.index !== undefined) {
        // Extract everything from this point forward
        message = message.substring(match.index).trim();
        foundStart = true;
        break;
      }
    }
    
    // Step 3: If we didn't find a clear start, try removing common prefixes
    if (!foundStart) {
      // Remove everything up to and including the first colon (for "Subject: X" cases)
      const colonIndex = message.indexOf(':');
      if (colonIndex > 0 && colonIndex < 50) {
        // If colon is early, likely a subject line - remove it
        message = message.substring(colonIndex + 1).trim();
      }
      
      // Remove common prefixes
      message = message.replace(/^Sure!?\s*/i, '');
      message = message.replace(/^Here'?s\s+.*?:?\s*/i, '');
      message = message.replace(/^You\s+can\s+use\s+.*?:?\s*/i, '');
    }
    
    // Step 4: Remove trailing garbage
    message = message.replace(/\n\s*---.*$/s, '');
    message = message.replace(/\n\s*Best,.*$/i, '');
    message = message.replace(/\n\s*\[Your Name\].*$/i, '');
    message = message.replace(/\n\s*\[Your Instagram handle.*$/i, '');
    message = message.replace(/\n\s*Feel free to customize.*$/i, '');
    
    // Step 5: If message STILL starts with "Subject:" or other garbage, nuclear option
    if (/^Subject:/i.test(message)) {
      // Find first line break after Subject and take everything after
      const afterSubject = message.split(/\n/).slice(1).join('\n').trim();
      if (afterSubject) {
        message = afterSubject;
      } else {
        // No line break, find first colon and take after
        const colonPos = message.indexOf(':');
        if (colonPos > -1) {
          message = message.substring(colonPos + 1).trim();
        }
      }
    }
    
    // Step 6: Final cleanup - remove any remaining "Subject:" references
    message = message.replace(/^Subject:\s*/gi, '');
    message = message.trim();
    
    // Step 7: If it STILL looks wrong, extract after first greeting word
    if (/^(?:Subject|Sure|Here'?s|You can)/i.test(message)) {
      // Find first actual word that looks like message content
      const greetingMatch = message.match(/\b(Hi|Hello|Hey|I'?m|We'?re|Greetings)\b/i);
      if (greetingMatch && greetingMatch.index !== undefined) {
        message = message.substring(greetingMatch.index).trim();
      }
    }
    
    message = message.trim();
    
    // Final validation
    if (/^(?:Subject|Sure|Here'?s|You can)/i.test(message)) {
      logger.warn(`⚠️ Message STILL contains meta-text: ${message.substring(0, 100)}`);
      // Last resort: take everything after first newline
      const lines = message.split('\n');
      if (lines.length > 1) {
        message = lines.slice(1).join('\n').trim();
      }
    }
    
    logger.info(`✅ Final cleaned message (${message.length} chars): ${message.substring(0, 100)}...`);
    return message;
  } catch (error) {
    logger.error(`OpenAI message generation failed:`, error);
    throw error;
  }
}

