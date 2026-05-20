import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function Placeholder({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{title}</h1>
      <Card>
        <CardHeader>
          <CardTitle>В разработке</CardTitle>
          <CardDescription>
            {description ?? "Этот раздел появится в следующем этапе."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Когда страница будет готова — здесь будут таблица, фильтры, формы создания и редактирования.
        </CardContent>
      </Card>
    </div>
  );
}
