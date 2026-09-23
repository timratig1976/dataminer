<?php

namespace App\Services;

class EmailExtrapolatorService
{
    /**
     * Generate ranked email candidates from first name, last name, and domain.
     * Handles German umlauts (ä->ae, ö->oe, etc.)
     */
    public function extrapolate(string $firstName, string $lastName, string $domain): array
    {
        $fn = $this->normalizeName($firstName);
        $ln = $this->normalizeName($lastName);
        $cleanDomain = strtolower(trim(preg_replace('/^https?:\/\//', '', $domain)));
        $cleanDomain = preg_replace('/\/.*$/', '', $cleanDomain);
        $cleanDomain = preg_replace('/^www\./', '', $cleanDomain);

        if (empty($fn) || empty($ln) || empty($cleanDomain)) {
            return [
                'candidates' => [],
                'best_guess' => null,
                'confidence' => 'none',
            ];
        }

        $fi = substr($fn, 0, 1);
        $li = substr($ln, 0, 1);

        $patterns = [
            ['pattern' => 'firstname.lastname', 'email' => "{$fn}.{$ln}@{$cleanDomain}", 'confidence' => 'high'],
            ['pattern' => 'f.lastname',          'email' => "{$fi}.{$ln}@{$cleanDomain}", 'confidence' => 'high'],
            ['pattern' => 'firstname',           'email' => "{$fn}@{$cleanDomain}",       'confidence' => 'medium'],
            ['pattern' => 'lastname',            'email' => "{$ln}@{$cleanDomain}",       'confidence' => 'medium'],
            ['pattern' => 'firstnamelastname',   'email' => "{$fn}{$ln}@{$cleanDomain}",  'confidence' => 'medium'],
            ['pattern' => 'f_lastname',          'email' => "{$fi}_{$ln}@{$cleanDomain}", 'confidence' => 'medium'],
            ['pattern' => 'firstname_lastname',  'email' => "{$fn}_{$ln}@{$cleanDomain}", 'confidence' => 'low'],
            ['pattern' => 'lastname.firstname',  'email' => "{$ln}.{$fn}@{$cleanDomain}", 'confidence' => 'low'],
        ];

        return [
            'candidates' => $patterns,
            'best_guess' => $patterns[0]['email'],
            'confidence' => 'high',
        ];
    }

    protected function normalizeName(string $name): string
    {
        $s = mb_strtolower(trim($name), 'UTF-8');
        $s = str_replace(
            ['ä', 'ö', 'ü', 'ß', 'à', 'á', 'â', 'é', 'è', 'ê', 'ó', 'ò', 'ô', 'ú', 'ù', 'û'],
            ['ae', 'oe', 'ue', 'ss', 'a', 'a', 'a', 'e', 'e', 'e', 'o', 'o', 'o', 'u', 'u', 'u'],
            $s
        );
        return preg_replace('/[^a-z0-9]/', '', $s);
    }
}
