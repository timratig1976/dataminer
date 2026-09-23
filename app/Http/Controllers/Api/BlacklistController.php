<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BlacklistDomain;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BlacklistController extends Controller
{
    /**
     * List blacklisted domains with search, filter, and sorting.
     * GET /api/blacklist
     */
    public function index(Request $request): JsonResponse
    {
        $search = trim((string) $request->input('search', ''));
        $sortBy = $request->input('sort_by', 'domain'); // domain, hit_count, created_at
        $sortDir = strtolower($request->input('sort_dir', 'asc')) === 'desc' ? 'desc' : 'asc';
        $limit = min(500, max(10, (int) $request->input('limit', 100)));

        $query = BlacklistDomain::query();

        if (!empty($search)) {
            $query->where(function ($q) use ($search) {
                $q->where('domain', 'like', "%{$search}%")
                  ->orWhere('reason', 'like', "%{$search}%")
                  ->orWhere('added_by', 'like', "%{$search}%");
            });
        }

        if (in_array($sortBy, ['domain', 'hit_count', 'created_at', 'reason'])) {
            $query->orderBy($sortBy, $sortDir);
        } else {
            $query->orderBy('domain', 'asc');
        }

        $items = $query->paginate($limit);

        return response()->json([
            'items' => $items->items(),
            'total' => $items->total(),
            'current_page' => $items->currentPage(),
            'last_page' => $items->lastPage(),
        ]);
    }

    /**
     * Add single or bulk domains to blacklist.
     * POST /api/blacklist
     */
    public function store(Request $request): JsonResponse
    {
        $domains = $request->input('domains'); // array or comma/newline-separated string
        $reason = $request->input('reason', 'Benutzerdefiniert');
        $addedBy = $request->input('added_by', 'user');

        if (is_string($domains)) {
            $domains = preg_split('/[\r\n,]+/', $domains);
        }

        if (!is_array($domains) || empty($domains)) {
            return response()->json(['error' => 'Keine Domains angegeben.'], 400);
        }

        $created = 0;
        foreach ($domains as $d) {
            $clean = strtolower(trim((string) $d));
            $clean = preg_replace('#^https?://#', '', $clean);
            $clean = preg_replace('#^www\.#', '', $clean);
            $clean = explode('/', $clean)[0];

            if (empty($clean) || !str_contains($clean, '.')) continue;

            $record = BlacklistDomain::firstOrCreate(
                ['domain' => $clean],
                ['reason' => $reason, 'added_by' => $addedBy]
            );
            if ($record->wasRecentlyCreated) {
                $created++;
            }
        }

        return response()->json([
            'ok' => true,
            'message' => "{$created} Domains zur Blacklist hinzugefügt.",
            'total' => BlacklistDomain::count(),
        ]);
    }

    /**
     * Delete domain from blacklist.
     * DELETE /api/blacklist/{id}
     */
    public function destroy(string $id): JsonResponse
    {
        $domain = BlacklistDomain::where('id', $id)->orWhere('domain', $id)->firstOrFail();
        $name = $domain->domain;
        $domain->delete();

        return response()->json([
            'ok' => true,
            'message' => "Domain '{$name}' aus der Blacklist entfernt.",
            'total' => BlacklistDomain::count(),
        ]);
    }
}
