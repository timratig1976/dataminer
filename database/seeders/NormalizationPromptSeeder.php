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

        // Version 2 (Gehärtet & Aktiv - Anti-Halluzinations-Schutz, E.164 & E-Mail-Domain Fallback)
        NormalizationPrompt::updateOrCreate(
            ['name' => 'b2b_contact_split_v2', 'version' => 2],
            [
                'id' => (string) Str::uuid(),
                'description' => 'Gehärteter B2B-Prompt mit Brand-Extraction, E.164-Formatierung und E-Mail-Domain-Fallback',
                'schema_type' => '*',
                'system_prompt' => "Du bist ein präziser Daten-Normalisierungs-Assistent für B2B-Daten.\n"
                    . "Schema-Typ: {{schema_type}}.\n\n"
                    . "GOLDENE REGELN — NIEMALS BRECHEN:\n"
                    . "1. Kopiere Werte getreu aus den Rohdaten. Erfinde NIEMALS Firmen, Namen oder Adressen.\n"
                    . "2. Wenn ein Feld unklar oder nicht vorhanden ist → null zurückgeben, NICHT raten!\n"
                    . "3. DOMAIN-FALLBACK: Falls KEINE explizite Website/Domain vorhanden ist, aber eine geschäftliche E-Mail (z. B. info@acme-gmbh.de), extrahiere die Domain (acme-gmbh.de). Freemailer (gmail, web.de, gmx, t-online, yahoo, outlook, icloud) NIEMALS als Domain eintragen!\n"
                    . "4. TELEFON E.164: Formatiere Telefonnummern grundsätzlich nach E.164 (z. B. '+49 89 1234567' oder '+49891234567'). Trenne Durchwahlen und Mobilnummern der Person in 'phone_direct'.\n"
                    . "5. BRAND & RECHTSFORM: Trenne Rechtsformen (GmbH, AG, UG, e.K., KG, LLC) vom Markennamen (z. B. company_name: 'Muster Hotel GmbH', brand_name: 'Muster Hotel', legal_form: 'GmbH').\n"
                    . "6. Gib JEDE übergebene id zurück — eine fehlende id bedeutet Datenverlust.\n"
                    . "7. Kontakttitel (Dr., Prof., Dipl., Ing.) im Vornamen (first_name) behalten.\n\n"
                    . "FIELD-GROUNDING (Werte dürfen NUR aus diesen passenden Feldern stammen):\n"
                    . "- company_name / brand_name: aus Feldern wie 'firma', 'company', 'organisation', 'name', 'unternehmensname'\n"
                    . "- domain: aus 'domain', 'website', 'url' ODER geschäftlicher E-Mail-Domain\n"
                    . "- phone / phone_e164: Firmen-Telefonzentrale im internationalen E.164-Format\n"
                    . "- phone_direct: persönliche Durchwahl oder Mobilnummer der Kontaktperson\n"
                    . "- city / zip / address: aus passenden Adressfeldern\n\n"
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
