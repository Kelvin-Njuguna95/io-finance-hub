'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatDate } from '@/lib/format';
import { Upload, CheckCircle, AlertTriangle, XCircle, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';

interface ImportRow {
  row_index: number;
  status: 'valid' | 'review' | 'reroute';
  errors: string[];
  warnings: string[];
  expense_date: string;
  expense_type: string;
  project_id: string | null;
  project_name: string;
  description: string;
  amount_kes: number;
  paid_to: string;
  payment_method: string;
  import_action: string;
  flag_detail: string;
  period_month: string;
  budget_id: string | null;
  budget_version_id: string | null;
}

interface ParseResult {
  file_name: string;
  total_rows: number;
  valid_count: number;
  review_count: number;
  reroute_count: number;
  rows: ImportRow[];
}

export default function ExpenseImportPage() {
  const { user } = useUser();
  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [approvedRows, setApprovedRows] = useState<Set<number>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported_count: number; skipped_count: number } | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();

    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/expenses/import', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session?.access_token}` },
      body: formData,
    });

    const result = await res.json();
    if (res.ok) {
      setParseResult(result);
      // Auto-approve all valid rows
      const autoApproved = new Set<number>();
      result.rows.forEach((r: ImportRow) => {
        if (r.status === 'valid') autoApproved.add(r.row_index);
      });
      setApprovedRows(autoApproved);
      setStep('review');
    } else {
      toast.error(result.error);
    }
    setUploading(false);
  }

  function toggleRow(idx: number) {
    const next = new Set(approvedRows);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setApprovedRows(next);
  }

  async function handleImport() {
    if (!parseResult) return;
    setImporting(true);

    const rowsToImport = parseResult.rows.filter(r => approvedRows.has(r.row_index));
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();

    const res = await fetch('/api/expenses/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ file_name: parseResult.file_name, rows: rowsToImport }),
    });

    const result = await res.json();
    if (result.success) {
      setImportResult(result);
      setStep('done');
      toast.success(`Imported ${result.imported_count} expenses`);
    } else {
      toast.error(result.error);
    }
    setImporting(false);
  }

  const statusIcon = (status: string) => {
    if (status === 'valid') return <CheckCircle className="h-4 w-4 text-success-soft-foreground" />;
    if (status === 'review') return <AlertTriangle className="h-4 w-4 text-warning-soft-foreground" />;
    return <XCircle className="h-4 w-4 text-danger-soft-foreground" />;
  };

  const statusBg = (status: string) => {
    if (status === 'valid') return '';
    if (status === 'review') return 'bg-warning-soft';
    return 'bg-danger-soft';
  };

  return (
    <div>
      <PageHeader title="Import Expenses" description="Upload an Excel file to batch-import expenses" />

      <div className="p-6 space-y-6">
        {/* UPLOAD STEP */}
        {step === 'upload' && (
          <Card className="io-card">
            <CardContent className="p-8 text-center">
              <FileSpreadsheet className="h-12 w-12 text-muted-foreground/60 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-foreground/90 mb-2">Upload Expense Spreadsheet</h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                Upload an .xlsx file with columns: expense_date, expense_type, project_id, description, amount_kes, paid_to, payment_method, approved_by, overhead_category, budget_link_note, import_action, flag_detail
              </p>
              <label className="inline-flex items-center gap-2 px-6 py-3 rounded-lg cursor-pointer btn-gradient text-white font-medium">
                <Upload className="h-4 w-4" />
                {uploading ? 'Processing...' : 'Choose File'}
                <input type="file" accept=".xlsx,.xls" onChange={handleUpload} className="hidden" disabled={uploading} />
              </label>
            </CardContent>
          </Card>
        )}

        {/* REVIEW STEP */}
        {step === 'review' && parseResult && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <Card className="io-card">
                <CardContent className="p-4">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Total Rows</p>
                  <p className="text-2xl font-bold">{parseResult.total_rows}</p>
                </CardContent>
              </Card>
              <Card className="io-card">
                <CardContent className="p-4">
                  <p className="text-[11px] uppercase tracking-wider text-success-soft-foreground font-medium">Ready to Import</p>
                  <p className="text-2xl font-bold text-success-soft-foreground">{parseResult.valid_count}</p>
                </CardContent>
              </Card>
              <Card className="io-card">
                <CardContent className="p-4">
                  <p className="text-[11px] uppercase tracking-wider text-warning-soft-foreground font-medium">Needs Review</p>
                  <p className="text-2xl font-bold text-warning-soft-foreground">{parseResult.review_count}</p>
                </CardContent>
              </Card>
              <Card className="io-card">
                <CardContent className="p-4">
                  <p className="text-[11px] uppercase tracking-wider text-danger-soft-foreground font-medium">Reroute (Blocked)</p>
                  <p className="text-2xl font-bold text-danger-soft-foreground">{parseResult.reroute_count}</p>
                </CardContent>
              </Card>
            </div>

            {/* Reroute warning */}
            {parseResult.reroute_count > 0 && (
              <div className="alert-danger rounded-lg p-4">
                <p className="text-sm font-medium text-danger-soft-foreground">Profit Share Entries Detected</p>
                <p className="text-sm text-danger-soft-foreground mt-1">
                  {parseResult.reroute_count} row(s) appear to be profit share payments, not operating expenses. These cannot be imported here — enter them in the Profit Share module instead.
                </p>
              </div>
            )}

            {/* Row table */}
            <Card className="io-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Review Rows</CardTitle>
                <Badge variant="secondary">{approvedRows.size} selected for import</Badge>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]"></TableHead>
                        <TableHead className="w-[30px]">#</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Paid To</TableHead>
                        <TableHead>Issues</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parseResult.rows.map((row) => (
                        <TableRow key={row.row_index} className={statusBg(row.status)}>
                          <TableCell>
                            {row.status !== 'reroute' && (
                              <input
                                type="checkbox"
                                checked={approvedRows.has(row.row_index)}
                                onChange={() => toggleRow(row.row_index)}
                                className="rounded border-border"
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{row.row_index}</TableCell>
                          <TableCell>{statusIcon(row.status)}</TableCell>
                          <TableCell className="text-sm">{row.expense_date}</TableCell>
                          <TableCell className="text-sm font-medium">{row.project_name}</TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">{row.description}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatCurrency(row.amount_kes, 'KES')}</TableCell>
                          <TableCell className="text-sm">{row.paid_to || '—'}</TableCell>
                          <TableCell>
                            {[...row.errors, ...row.warnings].map((msg, i) => (
                              <p key={i} className={`text-[11px] ${row.errors.includes(msg) ? 'text-danger-soft-foreground' : 'text-warning-soft-foreground'}`}>{msg}</p>
                            ))}
                            {row.flag_detail && <p className="text-[11px] text-muted-foreground">{row.flag_detail}</p>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Import actions */}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setStep('upload'); setParseResult(null); }}>
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={importing || approvedRows.size === 0}
                className="btn-gradient text-white"
              >
                {importing ? 'Importing...' : `Import ${approvedRows.size} Expenses`}
              </Button>
            </div>
          </>
        )}

        {/* DONE STEP */}
        {step === 'done' && importResult && (
          <Card className="io-card">
            <CardContent className="p-8 text-center">
              <CheckCircle className="h-12 w-12 text-success-soft-foreground mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-foreground/90 mb-2">Import Complete</h2>
              <p className="text-sm text-muted-foreground mb-4">
                {importResult.imported_count} expenses imported successfully.
                {importResult.skipped_count > 0 && ` ${importResult.skipped_count} rows skipped.`}
              </p>
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={() => { setStep('upload'); setParseResult(null); setImportResult(null); }}>
                  Import Another
                </Button>
                <Button onClick={() => window.location.href = '/expenses'} className="btn-gradient text-white">
                  View Expenses
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
