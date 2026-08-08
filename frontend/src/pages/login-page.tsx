import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { useAuth } from '@/services/state/auth-context'

export function LoginPage() {
  const navigate = useNavigate()
  const { user, login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  if (user) {
    return <Navigate to="/overview" replace />
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const success = login(username, password)
    if (!success) {
      setError('Please use username "admin" and password "password123".')
      return
    }
    navigate('/overview')
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-white text-slate-900">
      <style>{`@keyframes loginBgMove { from { background-position: 0% 0%; } to { background-position: 200% 200%; } }`}</style>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(135deg, rgba(59,130,246,0.9) 0%, rgba(56,189,248,0.7) 18%, rgba(168,85,247,0.9) 37%, rgba(248,113,113,0.5) 55%, rgba(59,130,246,0.75) 72%, rgba(168,85,247,0.85) 100%)',
          backgroundSize: '300% 300%',
          animation: 'loginBgMove 20s linear infinite',
          pointerEvents: 'none',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-white/80 via-slate-100/80 to-slate-200/80" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.24),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(168,85,247,0.18),_transparent_26%)]" />

      <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50 backdrop-blur-xl">
          <div className="mb-8 text-center">
            <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Inventory IQ</p>
            <p className="mt-2 text-sm text-slate-500">Sign in to access inventory analytics and reporting.</p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-slate-700">
              Username
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
                placeholder="Enter your username"
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
                placeholder="Enter your password"
              />
            </label>

            {error ? <p className="text-sm text-red-300">{error}</p> : null}

            <button
              type="submit"
              className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
