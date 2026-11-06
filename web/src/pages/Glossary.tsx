import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { glossary, Term } from '../glossary';

/** The definitions as a list, for the Glossary page and the client report. */
export function GlossaryList({ terms = glossary() }: { terms?: Term[] }) {
  return (
    <dl className="glossary">
      {terms.map((t) => (
        <div key={t.term}>
          <dt>{t.term}</dt>
          <dd>{t.definition}</dd>
        </div>
      ))}
    </dl>
  );
}

export function GlossaryPage() {
  return (
    <div className="stack">
      <PageHeader title="Glossary" subtitle="What each number and word on these pages means." actions={<Link to="/">Back to the dashboard</Link>} />
      <section className="card">
        <GlossaryList />
      </section>
    </div>
  );
}
