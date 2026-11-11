'use client';

import React, { useState, useRef, useEffect } from 'react';
import styles from './AIPricingCopilot.module.css';
import { getApiBase } from '../utils/api';

const STARTER_PROMPTS = [
  'Which products have cheaper competitors?',
  'Which competitors changed prices recently?',
  'Show products that need pricing review',
  'Explain my current pricing recommendations',
  'Which products do not have verified competitor prices?',
  'Give me an overall business summary'
];

export default function AIPricingCopilot() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: 'Hello! I am PricePilot Copilot, your intelligent pricing assistant. Ask me anything about your product catalog, competitor price changes, or dynamic repricing recommendations.',
      toolCalls: []
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const apiBase = getApiBase();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend) => {
    const query = (textToSend || input).trim();
    if (!query || isLoading) return;

    const newMessages = [...messages, { role: 'user', text: query }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      // Send conversation history (exclude first greeting)
      const history = newMessages.slice(1, -1).map((m) => ({
        role: m.role,
        content: m.text
      }));

      const res = await fetch(`${apiBase}/ai/copilot/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          message: query,
          history
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to process message.');
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.reply,
          toolCalls: data.toolCalls || []
        }
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `⚠️ I encountered an issue processing your request: ${err.message}. Please try asking about a specific product name, SKU, or recommendation.`,
          toolCalls: []
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        role: 'assistant',
        text: 'Chat history cleared. How can I help you analyze your store pricing today?',
        toolCalls: []
      }
    ]);
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <div className={styles.avatar}>✨</div>
          <div className={styles.titleText}>
            <h2 className={styles.heading}>AI Pricing Copilot</h2>
            <div className={styles.statusIndicator}>
              <span className={styles.statusDot} />
              <span>Grounded on Live MongoDB Data (Read-Only)</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          className={styles.clearButton}
          onClick={handleClearChat}
          title="Reset conversation"
        >
          Clear Chat
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className={styles.messagesArea}>
        {messages.map((msg, index) => {
          const isUser = msg.role === 'user';

          return (
            <div
              key={index}
              className={`${styles.messageRow} ${
                isUser ? styles.messageRowUser : styles.messageRowAssistant
              }`}
            >
              {!isUser && <div className={styles.botAvatarSmall}>✨</div>}
              {isUser && <div className={styles.userAvatarSmall}>YOU</div>}

              <div>
                {/* Tool calls execution chip if present */}
                {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div>
                    <span className={styles.toolCallTag}>
                      ⚡ Fetched live data: {msg.toolCalls.map((t) => t.name).join(', ')}
                    </span>
                  </div>
                )}

                <div
                  className={`${styles.bubble} ${
                    isUser ? styles.bubbleUser : styles.bubbleAssistant
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            </div>
          );
        })}

        {/* Loading Indicator */}
        {isLoading && (
          <div className={`${styles.messageRow} ${styles.messageRowAssistant}`}>
            <div className={styles.botAvatarSmall}>✨</div>
            <div className={styles.typingIndicator}>
              <div className={styles.typingDot} />
              <div className={styles.typingDot} />
              <div className={styles.typingDot} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompt Starters Strip */}
      <div className={styles.startersContainer}>
        <span className={styles.startersTitle}>Suggested Queries</span>
        <div className={styles.startersRow}>
          {STARTER_PROMPTS.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              className={styles.starterChip}
              onClick={() => handleSendMessage(prompt)}
              disabled={isLoading}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Input Form */}
      <form
        className={styles.inputForm}
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
      >
        <input
          type="text"
          className={styles.chatInput}
          placeholder="Ask Copilot about product prices, competitor discounts, recommendations..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
        />
        <button
          type="submit"
          className={styles.sendButton}
          disabled={isLoading || !input.trim()}
        >
          <span>Send</span>
          <span>➔</span>
        </button>
      </form>
    </div>
  );
}

