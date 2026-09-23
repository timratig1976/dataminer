<?php

namespace App\Mail;

use App\Services\EmailTemplateService;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class TemplateMailable extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $templateKey,
        public array $templateVariables = [],
        public ?string $overrideSubject = null
    ) {}

    public function build(EmailTemplateService $templateService): self
    {
        $rendered = $templateService->renderTemplate($this->templateKey, $this->templateVariables);
        $branding = $templateService->getBranding();

        $fromAddress = config('mail.from.address', 'apps@viminds.com');
        $fromName = !empty($branding['from_name']) ? $branding['from_name'] : config('mail.from.name', 'DataMiner');

        $this->from($fromAddress, $fromName)
             ->replyTo($fromAddress, $fromName)
             ->subject($this->overrideSubject ?: $rendered['subject'])
             ->html($rendered['html']);

        if (!empty($rendered['text'])) {
            $this->withSymfonyMessage(function (\Symfony\Component\Mime\Email $message) use ($rendered) {
                $message->text($rendered['text']);
            });
        }

        return $this;
    }
}
