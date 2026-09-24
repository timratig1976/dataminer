<?php

namespace App\Services;

use App\Models\DataCase;
use App\Models\GlobalSetting;
use App\Models\Row;
use Illuminate\Support\Facades\Log;

class RelevanceClassificationService
{
    public function __construct(
        protected EdenAiService $edenAi
    ) {}

    /**
     * Classifies a batch of rows against the case target context.
     * Marks atypic entries with `relevance_type` (target, catalog, association, irrelevant)
     * and stores `relevance_reason`.
     *
     * @param string $caseId
     * @param array|null $rowIds Optional array of specific row IDs to classify
     * @return array Summary of classified rows
     */
    public function classifyCaseRows(string $caseId, ?array $rowIds = null): array
    {
        $case = DataCase::find($caseId);
        if (!$case) {
            return ['error' => 'Case not found', 'classified' => 0];
        }

        $global = GlobalSetting::instance();
        $apiKey = $case->eden_api_key ?: ($global->eden_api_key ?: env('EDEN_API_KEY'));
        if (!$apiKey) {
            return ['error' => 'No API key configured for classification', 'classified' => 0];
        }

        $region = $case->eden_region ?: ($global->eden_region ?: 'eu');
        $model = 'openai/gpt-4o-mini';

        $query = Row::where('case_id', $case->id);
        if ($rowIds && count($rowIds) > 0) {
            $query->whereIn('id', $rowIds);
        } else {
            // Only classify rows that don't have a relevance_type yet
            $query->where(function ($q) {
                $q->whereNull("data->relevance_type")
                  ->orWhere("data->relevance_type", "");
            });
        }

        $rows = $query->limit(100)->get();
        if ($rows->isEmpty()) {
            return ['classified' => 0, 'message' => 'Keine unklassifizierten Zeilen vorhanden'];
        }

        // Process in chunks of 25 for fast LLM throughput and high accuracy
        $chunks = $rows->chunk(25);
        $totalClassified = 0;
        $atypicCount = 0;

        foreach ($chunks as $chunk) {
            $itemsToPrompt = [];
            foreach ($chunk as $r) {
                $d = $r->data ?? [];
                $itemsToPrompt[] = [
                    'id' => $r->id,
                    'name' => $d['company_name'] ?? $d['Unternehmen'] ?? 'Unbekannt',
                    'domain' => $d['domain'] ?? '',
                    'category' => $d['industry'] ?? $d['category'] ?? $d['Kategorie'] ?? '',
                    'address' => $d['address'] ?? $d['Adresse'] ?? '',
                    'city' => $d['city'] ?? $d['Stadt'] ?? '',
                ];
            }

            $caseContext = $case->name;
            $system = "Du bist ein präziser B2B-Lead-Relevanz-Prüfer. Antworte AUSSCHLIESSLICH mit einem validen JSON-Array.";
            $userPrompt = "Projekt-Kontext & Zielgruppe: \"{$caseContext}\"\n\n"
                . "Prüfe jeden der folgenden Einträge, ob es sich um ein echtes, operatives Einzelunternehmen der Zielgruppe handelt, oder um ein atypisches Ergebnis:\n"
                . "- \"target\": Echtes operatives Einzelunternehmen der Zielgruppe (z. B. einzelnes Hotel, Pension, Restaurant, Handwerksbetrieb).\n"
                . "- \"catalog\": Branchenverzeichnis, Bewertungsportal, Speisekarten-Portal oder Aggregator (z.B. speisekarte.menu, tripadvisor, gelbeseiten).\n"
                . "- \"association\": Dachverband, Innung, Verein, Verband e.V., Handwerkskammer, IHK, Tourismusverband, Behörde, Stadtmarketing.\n"
                . "- \"irrelevant\": Fremde Branche, Großzulieferer oder passt inhaltlich gar nicht zum Thema.\n\n"
                . "Antworte NUR als valides JSON-Array im Format:\n"
                . "[{\"id\": \"<id>\", \"relevance_type\": \"target|catalog|association|irrelevant\", \"reason\": \"prägnante Begründung (max 6 Wörter)\"}]\n\n"
                . "Einträge:\n" . json_encode($itemsToPrompt, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

            try {
                $chat = $this->edenAi->chatCompletion($apiKey, $model, $system, $userPrompt, 1200, 0.0, $region);
                $raw = trim(preg_replace('/^```(?:json)?\n?/i', '', preg_replace('/\n?```$/i', '', $chat['raw'] ?? '')));
                $results = json_decode($raw, true);

                if (is_array($results)) {
                    $resultsMap = collect($results)->keyBy('id');
                    foreach ($chunk as $r) {
                        $res = $resultsMap->get($r->id);
                        if ($res && isset($res['relevance_type'])) {
                            $d = $r->data ?? [];
                            $relType = $res['relevance_type'];
                            $d['relevance_type'] = $relType;
                            $d['relevance_reason'] = $res['reason'] ?? '';
                            $d['is_target'] = ($relType === 'target');
                            if ($relType === 'catalog') {
                                $d['is_catalog'] = 'true';
                            }
                            $r->update(['data' => $d]);
                            $totalClassified++;
                            if ($relType !== 'target') {
                                $atypicCount++;
                            }
                        }
                    }
                }
            } catch (\Throwable $e) {
                Log::warning("[RelevanceClassificationService] Batch error: " . $e->getMessage());
            }
        }

        return [
            'classified' => $totalClassified,
            'atypic_count' => $atypicCount,
            'message' => "{$totalClassified} Zeilen geprüft ({$atypicCount} atypische Treffer identifiziert).",
        ];
    }
}
