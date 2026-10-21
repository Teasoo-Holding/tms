import { FormEvent, useState } from 'react';
import { auth } from '../api/client';
import { ErrorNotice, Field, PasswordInput } from '../components/ui';

export function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(login.trim(), password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form className="card stack" style={{ width: 'min(380px, 100%)' }} onSubmit={submit}>
        <div>
          <h1>Tree Management System</h1>
          <p className="subtle" style={{ margin: '4px 0 0' }}>Sign in to the administration portal.</p>
        </div>
        <ErrorNotice error={error} />
        <Field label="Username, email or phone">
          <input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={login} onChange={(e) => setLogin(e.target.value)} />
        </Field>
        <Field label="Password">
          <PasswordInput autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
