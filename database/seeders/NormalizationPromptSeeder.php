<?php

namespace Database\Seeders;

use App\Models\NormalizationPrompt;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class NormalizationPromptSeeder extends Seeder
{
    public function run(): void
    {
        // Version 1 (Archived / Inaktiv)
        NormalizationPrompt::updateOrCreate(
            ['name' => 'b2b_contact_split_v1', 'version' => 1],
            [
                'id' => (string) Str::uuid(),
                'description' => 'Originaler Basis-Prompt (Legacy)',
                'schema_type' => '*',
                'system_prompt' => "Du bist ein präziser Daten-Normalisierungs-Assistent für B2B-Daten.\n"
                    . "Schema-Typ: {{schema_type}}.\n"
                    . "TRENNE Rohdaten sauber in Firmen-Felder und Kontaktpersonen-Felder.\n"
                    . "Firmen-Felder (company_fields): company_name, domain, phone, email, city, zip, address, industry, description, employees, founded.\n"
                    . "Kontakt-Felder (contact_fields): first_name, last_name, email, position, phone_direct, linkedin.\n"
                    . "Restliche unklare Felder in extra packen.\n"
                    . "confidence ist 0.0-1.0 (wie sicher du bist).\n"
                    . "Antworte AUSSCHLIESSLICH mit einem JSON-Array im Format:\n"
                    . "[{\"id\": \"...\", \"company_fields\": {...}, \"contact_fields\": {...}, \"extra\": {...}, \"confidence\": 0.95, \"notes\": \"...\"}]",
                'user_prompt_template' => "Normalisiere diese Zeilen:\n{{rows}}",
                'model' => 'openai/gpt-4o',
                'max_tokens' => 4000,
                'temperature' => 0.0,
                'max_rows_per_chunk' => 30,
                'is_active' => false,
            ]
        );

        // Version 2 (Gehärtet & Aktiv - Anti-Halluzinations-Schutz)
        NormalizationPrompt::updateOrCreate(
            ['name' => 'b2b_contact_split_v2', 'version' => 2],
            [
                'id' => (string) Str::uuid(),
                'description' => 'Gehärteter Prompt mit strengem Halluzinationsschutz und exaktem Feld-Grounding',
                'schema_type' => '*',
                'system_prompt' => "Du bist ein präziser Daten-Normalisierungs-Assistent für B2B-Daten.\n"
                    . "Schema-Typ: {{schema_type}}.\n\n"
                    . "GOLDENE REGELN — NIEMALS BRECHEN:\n"
                    . "1. Kopiere Werte EXAKT wie in den Rohdaten. Ändere keine Schreibweise und keine Groß/Kleinschreibung.\n"
                    . "2. Erfinde NIEMALS Werte. Wenn ein Feld unklar oder nicht vorhanden ist → null zurückgeben, NICHT raten!\n"
                    . "3. domain: NUR eintragen, wenn explizit eine URL oder Domain in den Rohdaten steht. Leite domain NIEMALS aus dem Firmennamen ab!\n"
                    . "4. Gib JEDE übergebene id zurück — eine fehlende id bedeutet Datenverlust.\n"
                    . "5. Kontakttitel (Dr., Prof., Dipl., Ing.) im Vornamen (first_name) behalten.\n\n"
                    . "FIELD-GROUNDING (Werte dürfen NUR aus diesen passenden Feldern stammen):\n"
                    . "- company_name: aus Feldern wie 'firma', 'company', 'organisation', 'name', 'unternehmensname'\n"
                    . "- domain: aus Feldern wie 'domain', 'website', 'web', 'url', 'homepage'\n"
                    . "- email / phone: exakt wie angegeben inkl. Leerzeichen und Durchwahlen\n"
                    . "- city / zip: aus passenden Adressfeldern\n\n"
                    . "AUSGABE-FORMAT (ausschließlich valides JSON-Array):\n"
                    . "[{\"id\":\"...\",\"company_fields\":{...},\"contact_fields\":{...},\"extra\":{...},\"confidence\":0.95,\"notes\":\"...\"}]",
                'user_prompt_template' => "Normalisiere diese {{rows_count}} Zeilen:\n{{rows}}",
                'model' => 'openai/gpt-4o',
                'max_tokens' => 4000,
                'temperature' => 0.0,
                'max_rows_per_chunk' => 10,
                'is_active' => true,
            ]
        );
    }
}
