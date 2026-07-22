import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';

export default function Chat({ compact }: { compact?: boolean }) {
  const app = useApp();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [app.chat.length]);

  const send = () => {
    app.sendChat(text);
    setText('');
  };

  return (
    <div className={`chat ${compact ? 'chat-compact' : ''}`}>
      <div className="chat-list" ref={listRef}>
        {app.chat.map((m) => (
          <div key={m.id} className={`chat-msg ${m.system ? 'system' : ''} ${m.authorId === app.identity.playerId ? 'mine' : ''}`}>
            {!m.system && <span className="chat-author">{m.author}</span>}
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
        {app.chat.length === 0 && <div className="chat-empty">No messages yet — say hi! 👋</div>}
      </div>
      <div className="chat-input-row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Type a message…"
          maxLength={300}
          aria-label="Chat message"
        />
        <button className="btn btn-small" onClick={send} disabled={!text.trim()}>Send</button>
      </div>
    </div>
  );
}
