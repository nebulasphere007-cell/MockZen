"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsContent, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { format } from "date-fns"
import { createClient } from "@/lib/supabase/client"
import { Card } from "@/components/ui/card"

interface User {
  id: string
  email: string
  name: string
  balance: number // Changed from credits to balance
}

interface CreditTransaction {
  id: string
  user_id: string
  delta: number
  reason: string
  metadata: any
  created_at: string
}

export function SuperAdminDashboard() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState("users")
  const [overviewData, setOverviewData] = useState<any>(null)
  const [users, setUsers] = useState<User[]>([])
  const [institutions, setInstitutions] = useState<any[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [loading, setLoading] = useState(false)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [userCredits, setUserCredits] = useState<{ balance: number; transactions: CreditTransaction[] } | null>(null)
  const [creditAmount, setCreditAmount] = useState<string>("")
  const [creditReason, setCreditReason] = useState<string>("")
  const [showUserDetails, setShowUserDetails] = useState(false)
  // New state for institution user creation
  const [institutionUserName, setInstitutionUserName] = useState("")
  const [institutionUserEmail, setInstitutionUserEmail] = useState("")
  const [institutionEmailDomain, setInstitutionEmailDomain] = useState("") // New state
  const [generatedPassword, setGeneratedPassword] = useState("")
  const [createInstitutionLoading, setCreateInstitutionLoading] = useState(false)

  const generatePassword = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+"
    let password = ""
    for (let i = 0; i < 16; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setGeneratedPassword(password)
    toast.info("Password generated!")
  }

  const handleCopyPassword = () => {
    navigator.clipboard.writeText(generatedPassword)
    toast.success("Password copied to clipboard!")
  }

  const handleCreateInstitutionUser = async () => {
    if (!institutionUserName || !institutionUserEmail || !institutionEmailDomain || !generatedPassword) {
      toast.error("Please fill in all fields and generate a password.")
      return
    }

    setCreateInstitutionLoading(true)
    try {
      // 1. Create the Institution first
      const institutionRes = await fetch("/api/super-admin/institutions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: institutionUserName, // Assuming institution name is the same as user name for simplicity
          email_domain: institutionEmailDomain,
        }),
      });

      const institutionData = await institutionRes.json();

      if (!institutionRes.ok) {
        toast.error(institutionData.error || "Failed to create institution.");
        return;
      }

      const newInstitutionId = institutionData.institution.id;

      // 2. Then, create the Institution User and link it to the new Institution
      const userRes = await fetch("/api/super-admin/institution-users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: institutionUserName,
          email: institutionUserEmail,
          password: generatedPassword,
          institution_id: newInstitutionId,
        }),
      });

      const data = await userRes.json();
      if (userRes.ok) {
        toast.success("Institution user created successfully!");
        setInstitutionUserName("");
        setInstitutionUserEmail("");
        setInstitutionEmailDomain(""); // Clear email domain as well
        setGeneratedPassword("");
        // Optionally refresh the institutions list if they are displayed elsewhere
        fetchInstitutions();
      } else {
        toast.error(data.error || "Failed to create institution user.");
      }
    } catch (error: any) {
      console.error("Error creating institution user:", error)
      toast.error(error.message || "An unexpected error occurred during user creation.")
    } finally {
      setCreateInstitutionLoading(false)
    }
  }

  const fetchOverviewData = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/super-admin/overview")
      const data = await res.json()
      if (res.ok) {
        setOverviewData(data)
      } else {
        toast.error(data.error || "Failed to fetch overview data")
      }
    } catch (error: any) {
      console.error("Error fetching overview:", error)
      toast.error(error.message || "An unexpected error occurred")
    } finally {
      setLoading(false)
    }
  }

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/super-admin/users?search=${searchTerm}&limit=1000`)
      const data = await res.json()
      if (res.ok) {
        setUsers(data.users)
      } else {
        toast.error(data.error || "Failed to fetch users")
      }
    } catch (error: any) {
      console.error("Error fetching users:", error)
      toast.error(error.message || "An unexpected error occurred")
    } finally {
      setLoading(false)
    }
  }

  const [editingInstitutionId, setEditingInstitutionId] = useState<string | null>(null)
  const [editingBalanceValue, setEditingBalanceValue] = useState<number | string>(0)

  const fetchInstitutions = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/super-admin/institutions")
      const data = await res.json()
      if (res.ok) {
        setInstitutions(data.institutions)
      } else {
        toast.error(data.error || "Failed to fetch institutions")
      }
    } catch (error: any) {
      console.error("Error fetching institutions:", error)
      toast.error(error.message || "An unexpected error occurred")
    } finally {
      setLoading(false)
    }
  } 

  const openSetBalance = (inst: any) => {
    setEditingInstitutionId(inst.id)
    setEditingBalanceValue(inst.balance ?? 0)
  }

  const refreshInstitution = async (instId: string) => {
    try {
      const res = await fetch(`/api/super-admin/institutions`)
      const data = await res.json()
      if (res.ok) {
        const updated = data.institutions.find((i: any) => i.id === instId)
        setInstitutions((prev) => prev.map((p) => (p.id === instId ? updated : p)))
        toast.success("Institution refreshed")
      } else {
        toast.error(data.error || "Failed to refresh")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to refresh")
    }
  }

  const handleSetInstitutionBalance = async (inst: any) => {
    if (!editingInstitutionId) return
    const desired = Number(editingBalanceValue)
    if (Number.isNaN(desired)) {
      toast.error("Please enter a valid numeric balance")
      return
    }

    try {
      setLoading(true)
      // Compute delta relative to current balance
      const delta = desired - (inst.balance || 0)
      if (delta === 0) {
        toast.info("Balance is already the requested amount")
        setEditingInstitutionId(null)
        return
      }

      // Send absolute value to server (set_to). Server will compute delta and record tx.
      const res = await fetch(`/api/super-admin/institutions/${inst.id}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ set_to: desired, reason: 'set_balance_by_super_admin' }),
      })
      const text = await res.text()
      let data: any = null
      try {
        data = text ? JSON.parse(text) : null
      } catch (err) {
        console.error('Failed to parse response JSON for set balance:', text, err)
      }

      if (res.ok) {
        const newBal = data?.newBalance ?? desired
        // Update local state
        setInstitutions((prev) => prev.map((p) => (p.id === inst.id ? { ...p, balance: newBal } : p)))
        toast.success('Institution balance updated')
        setEditingInstitutionId(null)
        setEditingBalanceValue(0)
      } else {
        const errMsg = data?.error || `Failed to update balance (HTTP ${res.status})`
        toast.error(errMsg)
        console.error('Set balance failed:', res.status, text)
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to update balance')
    } finally {
      setLoading(false)
    }
  }

  const fetchUserCredits = async (userId: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/super-admin/users/${userId}/credits`)
      const data = await res.json()
      if (res.ok) {
        setUserCredits(data)
      } else {
        toast.error(data.error || "Failed to fetch user credits")
      }
    } catch (error: any) {
      console.error("Error fetching user credits:", error)
      toast.error(error.message || "An unexpected error occurred")
    } finally {
      setLoading(false)
    }
  }

  const handleAddCredits = async () => {
    if (!selectedUser || !creditAmount) {
      toast.error("Please select a user and enter an amount")
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/super-admin/users/${selectedUser}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parseInt(creditAmount),
          reason: creditReason || "admin_adjustment",
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setCreditAmount("")
        setCreditReason("")
        fetchUserCredits(selectedUser) // Refresh credits after adding
        toast.success("Credits added successfully!")
      } else {
        toast.error(data.error || "Failed to add credits")
      }
    } catch (error: any) {
      console.error("Error adding credits from frontend:", error)
      toast.error(error.message || "An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === "overview") {
      fetchOverviewData()
    } else if (activeTab === "users") {
      fetchUsers()
    } else if (activeTab === "institutions" || activeTab === "create-institution-user") {
      fetchInstitutions()
    }
  }, [activeTab, searchTerm])

  useEffect(() => {
    if (selectedUser && showUserDetails) {
      fetchUserCredits(selectedUser)
    }
  }, [selectedUser, showUserDetails])

  const userToDisplay = users.find((u) => u.id === selectedUser)

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="institutions">Institutions</TabsTrigger>
          <TabsTrigger value="bulk-upload">Bulk Upload</TabsTrigger>
          <TabsTrigger value="create-institution-user">Create Institution User</TabsTrigger> {/* New tab */}
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
          <h2 className="text-xl font-semibold">Overview Data</h2>
          {loading ? (
            <p>Loading overview...</p>
          ) : overviewData ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="p-4">
                <h3 className="text-lg font-medium">Total Credits Issued</h3>
                <p className="text-2xl font-bold">{overviewData.total_credits_issued || 0}</p>
              </Card>
              <Card className="p-4">
                <h3 className="text-lg font-medium">Total Credits Remaining</h3>
                <p className="text-2xl font-bold">{overviewData.total_credits_remaining || 0}</p>
              </Card>
              <Card className="p-4">
                <h3 className="text-lg font-medium">Total GROQ Calls</h3>
                <p className="text-2xl font-bold">{overviewData.total_groq_calls || 0}</p>
              </Card>
            </div>
          ) : (
            <p>No overview data available.</p>
          )}
        </TabsContent>
        <TabsContent value="users" className="space-y-4">
          <h2 className="text-xl font-semibold">Users</h2>
          <Input
            type="text"
            placeholder="Search users by email or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-sm"
          />
          {loading ? (
            <p>Loading users...</p>
          ) : showUserDetails && userToDisplay ? (
            <div className="space-y-4 p-4 border rounded-md">
              <Button onClick={() => setShowUserDetails(false)}>← Back to Users</Button>
              <h3 className="text-xl font-semibold">User Details: {userToDisplay.email}</h3>
              <p><strong>Name:</strong> {userToDisplay.name}</p>
              <p><strong>Current Credits:</strong> {userCredits?.balance ?? "Loading..."}</p>
              <div className="mt-4 space-y-2">
                <h4 className="text-lg font-medium">Add Credits</h4>
                <div className="flex space-x-2">
                  <Input
                    type="number"
                    placeholder="Amount"
                    value={creditAmount}
                    onChange={(e) => setCreditAmount(e.target.value)}
                    className="w-32"
                  />
                  <Textarea
                    placeholder="Reason (optional)"
                    value={creditReason}
                    onChange={(e) => setCreditReason(e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={handleAddCredits} disabled={loading}>
                    Add
                  </Button>
                </div>
              </div>
              <div className="mt-8">
                <h4 className="text-lg font-medium">Credit Transactions</h4>
                {userCredits?.transactions && userCredits.transactions.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Delta</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Metadata</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {userCredits.transactions.map((txn) => (
                        <TableRow key={txn.id}>
                          <TableCell className={txn.delta > 0 ? "text-green-600" : "text-red-600"}>
                            {txn.delta > 0 ? `+${txn.delta}` : txn.delta}
                          </TableCell>
                          <TableCell>{txn.reason}</TableCell>
                          <TableCell>{format(new Date(txn.created_at), "PPP p")}</TableCell>
                          <TableCell>{JSON.stringify(txn.metadata)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p>No transactions found.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">S.No</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Credits</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user, index) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{index + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{user.id}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{user.name}</TableCell>
                      <TableCell>{user.balance}</TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedUser(user.id)
                            setShowUserDetails(true)
                          }}
                        >
                          View Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="institutions" className="space-y-4">
          <h2 className="text-xl font-semibold">Institutions</h2>
          {loading ? (
            <p>Loading institutions...</p>
          ) : institutions && institutions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">S.No</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email Domain</TableHead>
                  <TableHead>Admins</TableHead>
                  <TableHead>Credits Used</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {institutions.map((inst, index) => (
                  <TableRow key={inst.id}>
                    <TableCell className="font-medium">{index + 1}</TableCell>
                    <TableCell>{inst.name}</TableCell>
                    <TableCell>{inst.email_domain}</TableCell>
                    <TableCell>{inst.admin_count}</TableCell>
                    <TableCell>{inst.credits_used}</TableCell>
                    <TableCell>{inst.balance ?? 0}</TableCell>
                    <TableCell>
                      {editingInstitutionId === inst.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            className="border px-2 py-1 rounded w-28"
                            value={String(editingBalanceValue)}
                            onChange={(e) => setEditingBalanceValue(e.target.value)}
                          />
                          <Button size="sm" onClick={() => handleSetInstitutionBalance(inst)} disabled={loading}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingInstitutionId(null); setEditingBalanceValue(0) }}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => openSetBalance(inst)}>
                            Set Balance
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => refreshInstitution(inst.id)}>
                            Refresh
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p>No institutions found.</p>
          )}
        </TabsContent>
        <TabsContent value="bulk-upload" className="space-y-4">
          <h2 className="text-xl font-semibold">Bulk Upload</h2>
          <p>Bulk upload functionality coming soon.</p>
        </TabsContent>
        {/* New Tab Content for Institution User Creation */}
        <TabsContent value="create-institution-user" className="space-y-4">
          <h2 className="text-xl font-semibold">Create Institution User</h2>
          <Card className="p-4 space-y-4">
            <div>
              <label htmlFor="inst-user-name" className="block text-sm font-medium text-gray-700 mb-2">
                Name
              </label>
              <Input
                id="inst-user-name"
                type="text"
                placeholder="Institution User Name"
                value={institutionUserName}
                onChange={(e) => setInstitutionUserName(e.target.value)}
                className="max-w-md"
              />
            </div>
            <div>
              <label htmlFor="inst-user-email" className="block text-sm font-medium text-gray-700 mb-2">
                Institution User Email
              </label>
              <Input
                id="inst-user-email"
                type="email"
                placeholder="user@institution.edu"
                value={institutionUserEmail}
                onChange={(e) => setInstitutionUserEmail(e.target.value)}
                className="max-w-md"
              />
            </div>
            <div>
              <label htmlFor="inst-email-domain" className="block text-sm font-medium text-gray-700 mb-2">
                Institution Email Domain
              </label>
              <Input
                id="inst-email-domain"
                type="text"
                placeholder="institution.edu"
                value={institutionEmailDomain}
                onChange={(e) => setInstitutionEmailDomain(e.target.value)}
                className="max-w-md"
              />
            </div>
            <div className="flex items-end space-x-2">
              <div className="flex-1">
                <label htmlFor="generated-password" className="block text-sm font-medium text-gray-700 mb-2">
                  Generated Password
                </label>
                <Input
                  id="generated-password"
                  type="text"
                  readOnly
                  value={generatedPassword}
                  placeholder="Click 'Generate' to create a password"
                  className="w-full font-mono"
                />
              </div>
              <Button onClick={generatePassword} variant="outline">
                Generate
              </Button>
              <Button onClick={handleCopyPassword} disabled={!generatedPassword}>
                Copy
              </Button>
            </div>
            <Button
              onClick={handleCreateInstitutionUser}
              disabled={createInstitutionLoading || !institutionUserName || !institutionUserEmail || !institutionEmailDomain || !generatedPassword}
              className="w-full"
            >
              {createInstitutionLoading ? "Creating..." : "Create Institution User"}
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
