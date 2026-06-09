'use client';

import { useEffect, useState } from 'react';
import { api, Automation } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);

  useEffect(() => {
    api.getAutomations().then(setAutomations).catch(console.error);
  }, []);

  const handleToggle = async (automation: Automation) => {
    const updated = await api.updateAutomation(automation.id, { enabled: !automation.enabled });
    setAutomations((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Automationen</h1>

      {automations.length === 0 && (
        <p className="text-muted-foreground">Keine Automationen vorhanden.</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {automations.map((automation) => (
          <Card key={automation.id}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">{automation.name}</CardTitle>
              <Switch
                checked={automation.enabled}
                onCheckedChange={() => handleToggle(automation)}
              />
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div>
                <Badge variant="outline" className="mb-1">Auslöser</Badge>
                <pre className="text-xs bg-muted rounded p-2 overflow-auto">
                  {JSON.stringify(automation.trigger, null, 2)}
                </pre>
              </div>
              <div>
                <Badge variant="outline" className="mb-1">Aktion</Badge>
                <pre className="text-xs bg-muted rounded p-2 overflow-auto">
                  {JSON.stringify(automation.action, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
