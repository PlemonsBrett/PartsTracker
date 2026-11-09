import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const { error } =
      mode === 'in' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    if (error) setMsg(error.message);
    else if (mode === 'up') setMsg('Check your email to confirm, then sign in.');
  }

  return (
    <form className="login card" onSubmit={submit}>
      <h1>🔧 PartsTracker</h1>
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={8}
        autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
      />
      <button type="submit" className="primary">
        {mode === 'in' ? 'Sign in' : 'Create account'}
      </button>
      {msg && <p className="msg">{msg}</p>}
      <button type="button" className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? 'First time? Create account' : 'Have an account? Sign in'}
      </button>
    </form>
  );
}
