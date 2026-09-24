<?php

namespace App\Services;

class HtmlCleanerService
{
    /**
     * Common cookie banner and consent notice phrases in German and English
     */
    protected static array $cookiePatterns = [
        // German patterns
        '/.*(?:benutzt|verwendet|nutzt)\s+(?:cookies|technologien).*?(?:einverst[aä]ndnis|akzeptier|verstanden|ok|zustimm|ablehn|einstellungen).*/iu',
        '/.*wir\s+verwenden\s+cookies.*?(?:akzeptier|zustimm|ablehn|einstellungen|speichern).*/iu',
        '/.*cookie[- ]?(?:einstellungen|richtlinie|hinweis|banner|zustimmung|consent|pr[aä]ferenzen).*/iu',
        '/.*um\s+unsere\s+webseite\s+f[uü]r\s+sie\s+optimal\s+zu\s+gestalten.*?cookies.*/iu',
        '/.*diese\s+webseite\s+(?:verwendet|nutzt)\s+cookies.*/iu',
        '/.*alle\s+cookies\s+(?:akzeptieren|annehmen|ablehnen).*/iu',
        '/.*nur\s+notwendige\s+cookies.*/iu',
        '/.*auswahl\s+best[aä]tigen.*/iu',
        '/.*\[zur[uü]ck\s+nach\s+oben\].*/iu',

        // English patterns
        '/.*this\s+website\s+uses\s+cookies.*?(?:agree|consent|accept|decline|settings|ok).*/iu',
        '/.*we\s+use\s+cookies.*?(?:enhance|experience|accept|decline|consent|settings).*/iu',
        '/.*cookie\s+policy.*?accept.*/iu',
        '/.*accept\s+(?:all|necessary)\s+cookies.*/iu',
    ];

    /**
     * Clean markdown or text from cookie banner notices, navigation junk, and consent text.
     */
    public static function cleanMarkdown(?string $text): string
    {
        if (empty($text)) {
            return '';
        }

        // Split into lines or paragraphs
        $lines = explode("\n", $text);
        $filtered = [];

        foreach ($lines as $line) {
            $trimmed = trim($line);
            if (empty($trimmed)) {
                $filtered[] = '';
                continue;
            }

            // Check if line matches cookie banners or consent buttons
            $isCookie = false;
            foreach (self::$cookiePatterns as $pattern) {
                if (preg_match($pattern, $trimmed)) {
                    $isCookie = true;
                    break;
                }
            }

            if (!$isCookie) {
                $filtered[] = $line;
            }
        }

        $result = trim(implode("\n", $filtered));

        // Collapse 3+ consecutive newlines into 2
        $result = preg_replace("/\n{3,}/", "\n\n", $result);

        return $result;
    }

    /**
     * Check if a markdown snippet consists solely of cookie banner / junk text.
     */
    public static function isOnlyCookieOrJunk(string $text): bool
    {
        $cleaned = self::cleanMarkdown($text);
        // If stripped content is less than 60 characters or has no substantive words
        return strlen(trim($cleaned)) < 60;
    }
}
