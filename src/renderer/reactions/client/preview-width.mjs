export function setupPreviewWidth(cancel) {
  const button = document.querySelector('#preview-width-toggle');
  button.addEventListener('click', () => {
    cancel();
    const wide = document.body.classList.toggle('preview-wide');
    button.setAttribute('aria-pressed', String(wide));
    button.textContent = wide ? '通常の幅に戻す' : '横幅いっぱい';
    button.focus({preventScroll:true});
  });
}
