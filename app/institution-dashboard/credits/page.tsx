"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { format } from "date-fns"
import Link from "next/link"

interface Tx {
  id: string
  delta: number
  reason: string
  metadata: any
  created_at: string
}

export default function CreditsAuditPage() {
  const [balance, setBalance] = useState<number | null>(null)
  const [transactions, setTransactions] = useState<Tx[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/institution/credits')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to fetch')
      setBalance(typeof data.balance === 'number' ? data.balance : 0)
      setTransactions(data.transactions || [])
    } catch (err: any) {
      console.error('Failed to fetch credits', err)
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Institution Credits</h1>
            <p className="text-sm text-gray-600">Audit trail and balance for your institution</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/institution-dashboard">
              <Button variant="outline">Back to Dashboard</Button>
            </Link>
            <Button onClick={fetchData}>Refresh</Button>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Balance</CardTitle>
            <CardDescription>Current institution credit balance</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div>Loading...</div>
            ) : error ? (
              <div className="text-sm text-red-600">{error}</div>
            ) : (
              <div className="text-3xl font-bold text-gray-900">{balance}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Transactions</CardTitle>
            <CardDescription>Recent institution credit transactions</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div>Loading...</div>
            ) : transactions.length === 0 ? (
              <div className="text-sm text-gray-500">No transactions yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-sm text-gray-500">
                      <th className="py-2">Date</th>
                      <th className="py-2">Delta</th>
                      <th className="py-2">Reason</th>
                      <th className="py-2">Metadata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.id} className="border-t">
                        <td className="py-3 text-sm text-gray-600">{format(new Date(t.created_at), 'PP p')}</td>
                        <td className={`py-3 font-medium ${t.delta < 0 ? 'text-red-600' : 'text-green-600'}`}>{t.delta}</td>
                        <td className="py-3 text-sm text-gray-700">{t.reason}</td>
                        <td className="py-3 text-sm text-gray-600"><pre className="whitespace-pre-wrap">{JSON.stringify(t.metadata)}</pre></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
