// navigator.clipboard работает только в безопасном контексте (HTTPS или localhost), а панель в локальной сети
// открывается по http://<IP>:3000. В этом случае копируем через скрытое поле и execCommand.
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // разрешение не выдано: пробуем запасной способ
    }
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
