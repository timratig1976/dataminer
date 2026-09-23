<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Services\TemplateService;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CaseController extends Controller
{
    public function index()
    {
        return response()->json(DataCase::withCount('rows')->orderBy('updated_at', 'desc')->get());
    }

    public function templates()
    {
        return response()->json(TemplateService::getTemplates());
    }

    public function show(string $id)
    {
        $case = DataCase::withCount('rows')->find($id);
        if (!$case) {
            return response()->json(['error' => 'Not found'], 404);
        }
        return response()->json($case);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'template' => 'nullable|string',
            'columns' => 'nullable|array',
            'ai_columns' => 'nullable|array',
            'col_order' => 'nullable|array',
        ]);

        $columns = $validated['columns'] ?? [];
        $aiColumns = $validated['ai_columns'] ?? [];
        $colOrder = $validated['col_order'] ?? [];

        // Apply template if chosen (default to "standard" like Next.js)
        $templateId = $validated['template'] ?? 'standard';
        if ($templateId && $templateId !== 'none' && empty($columns) && empty($aiColumns)) {
            $allTemplates = TemplateService::getTemplates();
            $tpl = collect($allTemplates)->firstWhere('id', $templateId);
            if ($tpl) {
                $columns = array_map(fn($bc) => [
                    'id' => (string) Str::uuid(),
                    'key' => $bc['outputKey'],
                    'label' => $bc['name'],
                    'type' => 'text',
                ], $tpl['baseColumns'] ?? []);

                $aiColumns = $tpl['aiColumns'] ?? [];

                // Optimal proven column order from Next.js production:
                // domain → Firmendaten-KI → company_name → industry → address → zip → city
                // → description → phone → email → employees → founded
                // → maps_rating → category → maps_reviews → maps_url → Entscheider-KI
                $batchCompany = collect($aiColumns)->firstWhere('tool', 'batch_company');
                $batchContacts = collect($aiColumns)->firstWhere('tool', 'batch_contact');
                $vilocalAudit = collect($aiColumns)->firstWhere('outputKey', 'vilocal_audit');

                $colOrder = array_values(array_filter([
                    'domain',
                    '_scrape_cached_ts',
                    $batchCompany ? $batchCompany['outputKey'] : null,
                    'company_name',
                    'industry',
                    'address',
                    'zip',
                    'city',
                    'description',
                    'phone',
                    'email',
                    'company_email',
                    'employees',
                    'founded',
                    'maps_rating',
                    'category',
                    'maps_reviews',
                    'maps_url',
                    $vilocalAudit ? $vilocalAudit['outputKey'] : null,
                    $batchContacts ? $batchContacts['outputKey'] : null,
                ]));
            }
        }

        $case = DataCase::create([
            'id' => (string) Str::uuid(),
            'name' => $validated['name'],
            'description' => $validated['description'] ?? null,
            'columns' => $columns,
            'ai_columns' => $aiColumns,
            'col_order' => $colOrder,
            'eden_region' => 'eu',
        ]);

        return response()->json($case, 201);
    }

    public function update(Request $request, string $id)
    {
        $case = DataCase::find($id);
        if (!$case) {
            return response()->json(['error' => 'Not found'], 404);
        }

        $payload = $request->only([
            'name',
            'ai_columns',
            'col_order',
            'eden_api_key',
            'eden_region',
            'model_allowlist',
        ]);

        // Support camelCase from frontend (aiColumns, colOrder, etc.)
        if ($request->has('aiColumns') && !isset($payload['ai_columns'])) {
            $payload['ai_columns'] = $request->input('aiColumns');
        }
        if ($request->has('colOrder') && !isset($payload['col_order'])) {
            $payload['col_order'] = $request->input('colOrder');
        }

        $case->update($payload);

        $response = $case->toArray();
        $response['aiColumns'] = $case->ai_columns;
        $response['colOrder'] = $case->col_order;

        return response()->json($response);
    }

    public function destroy(string $id)
    {
        $case = DataCase::find($id);
        if (!$case) {
            return response()->json(['error' => 'Not found'], 404);
        }

        $case->delete();
        return response()->json(['ok' => true]);
    }

    /**
     * Hard stop all background jobs, agent runs and enrichment tasks for a case.
     * POST /api/cases/{id}/stop
     */
    public function stopAll(string $id): JsonResponse
    {
        $case = DataCase::find($id);
        if (!$case) {
            return response()->json(['error' => 'Case not found'], 404);
        }

        // 1. Cancel all running or pending Enrichment Jobs for this case
        $stoppedJobsCount = \App\Models\EnrichmentJob::where('case_id', $case->id)
            ->whereIn('status', ['running', 'queued', 'pending'])
            ->update(['status' => 'cancelled']);

        // 2. Cancel all active Agent Runs for this case
        $stoppedAgentRunsCount = \App\Models\AgentRun::where('case_id', $case->id)
            ->whereIn('status', ['running', 'queued', 'pending'])
            ->update(['status' => 'cancelled']);

        // 3. Reset any row cells stuck in 'running' back to 'idle'
        $resetRowsCount = 0;
        try {
            $rows = \App\Models\Row::where('case_id', $case->id)->get();
            foreach ($rows as $row) {
                $statuses = $row->cell_statuses ?? [];
                $modified = false;
                foreach ($statuses as $colKey => $st) {
                    if ($st === 'running') {
                        $statuses[$colKey] = 'idle';
                        $modified = true;
                    }
                }
                if ($modified) {
                    $row->update(['cell_statuses' => $statuses]);
                    $resetRowsCount++;
                }
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("Resetting running cell statuses failed: " . $e->getMessage());
        }

        return response()->json([
            'ok' => true,
            'message' => 'Prozess für diesen Case sofort gestoppt.',
            'stopped_jobs' => $stoppedJobsCount,
            'stopped_agent_runs' => $stoppedAgentRunsCount,
            'reset_rows' => $resetRowsCount,
        ]);
    }
}
