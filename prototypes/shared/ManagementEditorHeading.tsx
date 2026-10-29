// Preserve the original comparison chrome independently of the production editor.
import './management-editor-heading.css';

interface EditorIntroduction {
  heading: string;
  body: string;
}

export function ManagementEditorHeading({ title, backPage, onBack, introduction, description }: {
  title: string; backPage: string; onBack(): void;
  introduction?: EditorIntroduction; description?: string;
}) {
  return <div className={`editor-heading prototype-editor-heading${introduction ? ' editor-heading-with-introduction' : ''}`}>
    <div className="editor-heading-row">
      <button className="back-button" data-icon-only={Boolean(introduction) || undefined}
        aria-label={`← ${backPage}に戻る`} title={`${backPage}に戻る`} onClick={onBack}>
        {introduction ? '←' : `← ${backPage}`}
      </button>
      <h1 id="editor-heading" tabIndex={-1}>{title}</h1>
    </div>
    {introduction ? <div className="editor-introduction"><span aria-hidden="true">◇</span>
      <div><strong>{introduction.heading}</strong><p>{introduction.body}</p></div>
    </div> : description && <p>{description}</p>}
  </div>;
}
