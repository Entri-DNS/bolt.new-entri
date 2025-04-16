import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { fileModificationsToHTML } from '~/utils/diff';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import type { SharingLinks } from '~/types/entri';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory } = useChatHistory();

  return (
    <>
      {ready && <ChatImpl initialMessages={initialMessages} storeMessageHistory={storeMessageHistory} />}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          /**
           * @todo Handle more types if we need them. This may require extra color palettes.
           */
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
      />
    </>
  );
}

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
}

export const ChatImpl = memo(({ initialMessages, storeMessageHistory }: ChatProps) => {
  useShortcuts();

  const isValidNetlifyHostname = (hostname: string | null): boolean => {
    if (!hostname) return false;
    
    // Check if it's a valid netlify.app subdomain
    const netlifyRegex = /^[a-zA-Z0-9-]+\.netlify\.app$/;
    return netlifyRegex.test(hostname);
  };

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const processedUserMessageIdRef = useRef<string | null>(null); 


  const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);

  const { showChat } = useStore(chatStore);

  const [animationScope, animate] = useAnimate();

  const { messages, isLoading, input, handleInputChange, setInput, stop, append } = useChat({
    api: '/api/chat',
    onError: (error) => {
      logger.error('Request failed\n\n', error);
      toast.error('There was an error processing your request');
    },
    onFinish: () => {
      logger.debug('Finished streaming');
      },
    initialMessages,
  });
  useEffect(() => {
    if (!isLoading && messages.length > 1) {
      const lastMessage = messages[messages.length - 1];
      const secondLastMessage = messages[messages.length - 2];

      if (
        lastMessage.role === 'assistant' && 
        secondLastMessage?.role === 'user' &&
        secondLastMessage.id !== processedUserMessageIdRef.current &&
        !chatStore.get().aborted
      ) { 
        if (lastMessage.content.includes("To easily point your existing domain")) {
          processedUserMessageIdRef.current = secondLastMessage.id;
          return; 
        }

        // First check for Netlify deployment in the assistant's message
        let netlifyHostname: string | null = null;
        const netlifyRegex = /https?:\/\/([a-zA-Z0-9][-a-zA-Z0-9]*\.netlify\.app)/i;
        const deploymentIndicators = ["deployed", "live", "site is", "available at", "deployed to netlify"];
        const netlifyMatch = lastMessage.content.match(netlifyRegex);
        if (netlifyMatch && netlifyMatch[1] && isValidNetlifyHostname(netlifyMatch[1])) {
          netlifyHostname = netlifyMatch[1];
          
          // Check if the message context suggests this is a deployment
          const urlIndex = lastMessage.content.indexOf(netlifyHostname);
          const contextWindow = lastMessage.content.substring(
            Math.max(0, urlIndex - 100), 
            Math.min(lastMessage.content.length, urlIndex + netlifyHostname.length + 100)
          ).toLowerCase();
          
          const isDeploymentMessage = deploymentIndicators.some(phrase => contextWindow.includes(phrase));
          
          if (isDeploymentMessage) {
            logger.debug(`Found Netlify deployment: ${netlifyHostname}`);
            processedUserMessageIdRef.current = secondLastMessage.id;
            
            setTimeout(async () => {
              try {
                const response = await fetch('/api/entri-links', {
                  method: 'POST',
                  body: JSON.stringify({ hostname: netlifyHostname }),
                });
                if (!response.ok) {
                  throw new Error(`API request failed with status ${response.status}`);
                }
                const links: SharingLinks = await response.json();

                if (links.connectLink || links.sellLink) {
                  const linksMessage = `<strong>Need to connect your domain to Netlify?</strong>
Entri can help you set up DNS in just a few clicks.

👉 <strong>Use your existing domain</strong>
We'll configure the DNS records for you.

<a href="${links.connectLink || '#'}">Set up DNS</a>
or
🌐 <strong>Get a new domain — totally FREE!</strong>
Grab a free domain and we'll set up all the DNS for Netlify, instantly.

<a href="${links.sellLink || '#'}" target="_blank">Claim your free domain</a>`;
                  
                  append({
                    role: 'assistant',
                    content: linksMessage,
                  }); 
                } else {
                  logger.debug('No valid links received from API.');
                }
              } catch (error) {
                logger.error('Failed to fetch Entri links', error);
              }
            }, 1000);
            return;
          }
        }
        
        // If we get here, we didn't find a clear Netlify deployment message
        processedUserMessageIdRef.current = secondLastMessage.id;
      }
    }
  }, [messages, isLoading, append]); 



  const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
  const { parsedMessages, parseMessages } = useMessageParser();

  const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

  useEffect(() => {
    chatStore.setKey('started', initialMessages.length > 0);
  }, []);

  useEffect(() => {
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  }, [messages, isLoading, parseMessages]);

  const scrollTextArea = () => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  const abort = () => {
    stop();
    chatStore.setKey('aborted', true);
    workbenchStore.abortAllActions();
  };

  useEffect(() => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.style.height = 'auto';

      const scrollHeight = textarea.scrollHeight;

      textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
      textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
    }
  }, [input, textareaRef]);

  const runAnimation = async () => {
    if (chatStarted) {
      return;
    }

    await Promise.all([
      animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
      animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
    ]);

    chatStore.setKey('started', true);

    setChatStarted(true);
  };

  const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
    const _input = messageInput || input;

    if (_input.length === 0 || isLoading) {
      return;
    }

    /**
     * @note (delm) Usually saving files shouldn't take long but it may take longer if there
     * many unsaved files. In that case we need to block user input and show an indicator
     * of some kind so the user is aware that something is happening. But I consider the
     * happy case to be no unsaved files and I would expect users to save their changes
     * before they send another message.
     */
    await workbenchStore.saveAllFiles();

    const fileModifications = workbenchStore.getFileModifcations();

    chatStore.setKey('aborted', false);

    runAnimation();

    if (fileModifications !== undefined) {
      const diff = fileModificationsToHTML(fileModifications);

      /**
       * If we have file modifications we append a new user message manually since we have to prefix
       * the user input with the file modifications and we don't want the new user input to appear
       * in the prompt. Using `append` is almost the same as `handleSubmit` except that we have to
       * manually reset the input and we'd have to manually pass in file attachments. However, those
       * aren't relevant here.
       */
      append({ role: 'user', content: `${diff}\n\n${_input}` });

      /**
       * After sending a new message we reset all modifications since the model
       * should now be aware of all the changes.
       */
      workbenchStore.resetAllFileModifications();
    } else {
      append({ role: 'user', content: _input });
    }

    setInput('');

    resetEnhancer();

    textareaRef.current?.blur();
  };

  const [messageRef, scrollRef] = useSnapScroll();

  return (
    <BaseChat
      ref={animationScope}
      textareaRef={textareaRef}
      input={input}
      showChat={showChat}
      chatStarted={chatStarted}
      isStreaming={isLoading}
      enhancingPrompt={enhancingPrompt}
      promptEnhanced={promptEnhanced}
      sendMessage={sendMessage}
      messageRef={messageRef}
      scrollRef={scrollRef}
      handleInputChange={handleInputChange}
      handleStop={abort}
      messages={messages.map((message, i) => {
        if (message.role === 'user') {
          return message;
        }

        return {
          ...message,
          content: parsedMessages[i] || '',
        };
      })}
      enhancePrompt={() => {
        enhancePrompt(input, (input) => {
          setInput(input);
          scrollTextArea();
        });
      }}
    />
  );
});
