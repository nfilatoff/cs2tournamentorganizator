import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconMore } from './Icons';

// Меню дополнительных действий. Popover лежит в верхнем слое, поэтому его не обрезают прокрутка сетки и границы карточек.
export function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const place = () => {
    const b = button.current?.getBoundingClientRect();
    const m = menu.current;
    if (!b || !m) return;
    const gap = 6;
    const pad = 8;
    const left = Math.max(pad, Math.min(b.right - m.offsetWidth, window.innerWidth - m.offsetWidth - pad));
    const below = b.bottom + gap + m.offsetHeight <= window.innerHeight - pad;
    const top = below ? b.bottom + gap : Math.max(pad, b.top - gap - m.offsetHeight);
    m.style.left = `${left}px`;
    m.style.top = `${top}px`;
  };

  // Меню привязано к кнопке: при прокрутке страницы оно закрывается, а не уплывает от неё
  useEffect(() => {
    const close = (e: Event) => {
      const m = menu.current;
      if (m?.matches(':popover-open') && !(e.target instanceof Node && m.contains(e.target))) m.hidePopover();
    };
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, []);

  return (
    <>
      <button ref={button} type="button" className="iconbtn" popoverTarget={id} aria-label={label} title={label}><IconMore /></button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        className="menu"
        onToggle={(e) => { if (e.newState === 'open') place(); }}
        onClick={(e) => {
          // Нажатие на действие закрывает меню, а поля ввода внутри него остаются доступны
          if ((e.target as HTMLElement).closest('button, a')) menu.current?.hidePopover();
        }}
      >
        {children}
      </div>
    </>
  );
}
