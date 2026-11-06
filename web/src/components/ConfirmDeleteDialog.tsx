import { useEffect, useRef, useState, type FormEvent } from 'react';
import { randomWord } from '../confirmWords';
import { useI18n } from '../i18n';

// Вторая и третья проверки перед удалением (первая — нажатие самой кнопки): вопрос, затем ввод показанного слова
export function ConfirmDeleteDialog({ question, onConfirm, onCancel }: { question: string; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [word] = useState(randomWord);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const matches = typed.trim().toLowerCase() === word;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (matches) onConfirm();
  };

  return (
    <dialog ref={ref} className="confirmdialog" onCancel={onCancel}>
      <h2>{t('confirmDelete.title')}</h2>
      {!typing ? (
        <>
          <p>{question}</p>
          <div className="confirmactions">
            <button type="button" className="ghost" autoFocus onClick={onCancel}>{t('common.cancel')}</button>
            <button type="button" className="danger" onClick={() => setTyping(true)}>{t('confirmDelete.continue')}</button>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          <p>{t('confirmDelete.typeWord')}</p>
          <p className="confirmword">{word}</p>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={t('confirmDelete.typeWord')} autoFocus autoComplete="off" spellCheck={false} />
          <div className="confirmactions">
            <button type="button" className="ghost" onClick={onCancel}>{t('common.cancel')}</button>
            <button type="submit" className="danger" disabled={!matches}>{t('common.delete')}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}
