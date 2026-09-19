<?php

namespace App\Services;

use App\Models\GlobalSetting;

class PlannerService
{
    protected EdenAiService $eden;

    public function __construct(EdenAiService $eden)
    {
        $this->eden = $eden;
    }

    /**
     * German cities by region for query expansion without LLM tokens
     */
    protected array $regionCities = [
        'berlin' => ['Berlin Mitte', 'Berlin Charlottenburg', 'Berlin Kreuzberg', 'Berlin Spandau', 'Berlin Pankow'],
        'hamburg' => ['Hamburg Mitte', 'Hamburg Altona', 'Hamburg Wandsbek', 'Hamburg Harburg'],
        'muenchen' => ['München Schwabing', 'München Sendling', 'München Bogenhausen', 'München Pasing'],
        'nrw' => ['Köln', 'Düsseldorf', 'Dortmund', 'Essen', 'Duisburg', 'Bochum', 'Wuppertal', 'Bonn', 'Münster'],
        'bayern' => ['München', 'Nürnberg', 'Augsburg', 'Regensburg', 'Ingolstadt', 'Würzburg', 'Fürth', 'Erlangen'],
        'bw' => ['Stuttgart', 'Mannheim', 'Karlsruhe', 'Freiburg', 'Heidelberg', 'Heilbronn', 'Ulm', 'Pforzheim'],
        'hessen' => ['Frankfurt am Main', 'Wiesbaden', 'Kassel', 'Darmstadt', 'Offenbach', 'Hanau', 'Gießen'],
        'sachsen' => ['Leipzig', 'Dresden', 'Chemnitz', 'Zwickau', 'Plauen', 'Görlitz'],
        'mv' => ['Rostock', 'Schwerin', 'Neubrandenburg', 'Stralsund', 'Greifswald', 'Wismar', 'Güstrow'],
    ];

    /**
     * Creates an executable DiscoveryPlan from a natural language prompt.
     */
    public function createPlan(string $userGoal): array
    {
        $settings = GlobalSetting::instance();
        $customPrompt = $settings->planner_system_prompt;

        $systemPrompt = $customPrompt ?: "You are an expert lead generation planner for the DACH market.\n"
            . "Given a user goal, output a compact JSON plan containing search and maps steps.\n"
            . "Output format strictly JSON with no markdown:\n"
            . "{\n"
            . '  "goal_summary": "short summary",' . "\n"
            . '  "steps": [' . "\n"
            . '    {"id": "step_1", "type": "google_search", "label": "Search title", "query": "exact search query", "estimated_hits": 20},' . "\n"
            . '    {"id": "step_2", "type": "google_maps", "label": "Maps search", "map_query": "search query", "location": "city or region", "estimated_hits": 30}' . "\n"
            . "  ]\n"
            . "}";

        try {
            $response = $this->eden->chatCompletion([
                ['role' => 'system', 'content' => $systemPrompt],
                ['role' => 'user', 'content' => "Create a discovery plan for: " . $userGoal],
            ], 'openai/gpt-4o-mini', 0.1);

            $cleaned = preg_replace('/^```(?:json)?\s*/i', '', trim($response));
            $cleaned = preg_replace('/\s*```$/', '', $cleaned);

            $plan = json_decode($cleaned, true);
            if (empty($plan['steps'])) {
                return $this->fallbackPlan($userGoal);
            }

            return $plan;
        } catch (\Throwable $e) {
            return $this->fallbackPlan($userGoal);
        }
    }

    protected function fallbackPlan(string $userGoal): array
    {
        return [
            'goal_summary' => $userGoal,
            'steps' => [
                [
                    'id' => 'step_1',
                    'type' => 'google_search',
                    'label' => 'Web Search: ' . substr($userGoal, 0, 30),
                    'query' => $userGoal,
                    'estimated_hits' => 15,
                ],
                [
                    'id' => 'step_2',
                    'type' => 'google_maps',
                    'label' => 'Maps Search: ' . substr($userGoal, 0, 30),
                    'map_query' => $userGoal,
                    'location' => 'Deutschland',
                    'estimated_hits' => 20,
                ],
            ],
        ];
    }
}
