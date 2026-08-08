import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react'

interface User {
  username: string
}

interface AuthContextValue {
  user: User | null
  login: (username: string, password: string) => boolean
  logout: () => void
}

const STORAGE_KEY = 'inventory-intelligence-auth'

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as User
    return typeof parsed?.username === 'string' ? parsed : null
  } catch {
    return null
  }
}

function writeStoredUser(user: User | null) {
  try {
    if (user === null) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  } catch {
    /* ignore storage failures */
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(() => readStoredUser())

  const login = (username: string, password: string) => {
    const normalizedUsername = username.trim()
    const normalizedPassword = password.trim()
    if (normalizedUsername !== 'admin' || normalizedPassword !== 'password123') {
      return false
    }

    const nextUser = { username: normalizedUsername }
    setUser(nextUser)
    writeStoredUser(nextUser)
    return true
  }

  const logout = () => {
    setUser(null)
    writeStoredUser(null)
  }

  const value = useMemo(() => ({ user, login, logout }), [user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
