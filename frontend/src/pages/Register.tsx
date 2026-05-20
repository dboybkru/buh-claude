import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { extractApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await register(email, password, fullName);
      toast.success("Аккаунт создан");
      navigate("/", { replace: true });
    } catch (err) {
      const api = extractApiError(err);
      const detail = api.details?.fieldErrors;
      const msg = detail
        ? Object.values(detail).flat().join("; ")
        : api.message ?? "Не удалось зарегистрироваться";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Регистрация</CardTitle>
          <CardDescription>Создайте аккаунт BuhClaude</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">ФИО</Label>
              <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль (мин. 8 символов)</Label>
              <Input
                id="password"
                type="password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Создание..." : "Создать аккаунт"}
            </Button>
            <div className="text-sm text-center text-muted-foreground">
              Уже есть аккаунт?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Войти
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
