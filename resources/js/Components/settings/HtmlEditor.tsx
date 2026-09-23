import React, { useRef, useState, useEffect } from 'react';
import { Bold, Italic, Link2, Code, Eye, List, AlignLeft, AlignCenter } from 'lucide-react';

interface Props {
    html: string;
    onChange: (newHtml: string) => void;
    availablePlaceholders: string[];
    rows?: number;
}

export default function HtmlEditor({ html, onChange, availablePlaceholders, rows = 6 }: Props) {
    const [mode, setMode] = useState<'visual' | 'code'>('visual');
    const visualEditorRef = useRef<HTMLDivElement>(null);
    const isTypingRef = useRef(false);

    // Keep visual editor content in sync when html prop updates externally or mode changes
    useEffect(() => {
        if (mode === 'visual' && visualEditorRef.current && !isTypingRef.current) {
            if (visualEditorRef.current.innerHTML !== html) {
                visualEditorRef.current.innerHTML = html || '';
            }
        }
    }, [html, mode]);

    const execCommand = (command: string, value: string | undefined = undefined) => {
        if (visualEditorRef.current) {
            visualEditorRef.current.focus();
            document.execCommand(command, false, value);
            onChange(visualEditorRef.current.innerHTML);
        }
    };

    const handleVisualInput = () => {
        if (visualEditorRef.current) {
            isTypingRef.current = true;
            onChange(visualEditorRef.current.innerHTML);
            setTimeout(() => {
                isTypingRef.current = false;
            }, 100);
        }
    };

    const insertTag = (tag: string) => {
        const placeholder = `{{ ${tag} }}`;
        if (mode === 'visual' && visualEditorRef.current) {
            visualEditorRef.current.focus();
            document.execCommand('insertText', false, placeholder);
            onChange(visualEditorRef.current.innerHTML);
        } else {
            onChange(html + ' ' + placeholder);
        }
    };

    const handleCreateLink = () => {
        const url = prompt('Link URL eingeben (z.B. {{ magic_link_url }} oder https://...):', 'https://');
        if (url) {
            execCommand('createLink', url);
        }
    };

    return (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
            {/* Editor Top Toolbar */}
            <div className="bg-slate-50 border-b border-slate-200 p-2 flex items-center justify-between gap-2 flex-wrap text-xs">
                {/* Visual vs Code Mode Toggle */}
                <div className="inline-flex p-0.5 bg-slate-200/80 rounded-lg gap-0.5">
                    <button
                        type="button"
                        onClick={() => setMode('visual')}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                            mode === 'visual'
                                ? 'bg-white text-orange-600 shadow-xs font-semibold'
                                : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                        <Eye className="w-3 h-3" />
                        <span>Visuell</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode('code')}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                            mode === 'code'
                                ? 'bg-white text-orange-600 shadow-xs font-semibold'
                                : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                        <Code className="w-3 h-3" />
                        <span>HTML Code</span>
                    </button>
                </div>

                {/* Formatting Tools in Visual Mode */}
                {mode === 'visual' && (
                    <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
                        <button
                            type="button"
                            onClick={() => execCommand('bold')}
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-700 cursor-pointer"
                            title="Fett (Strg+B)"
                        >
                            <Bold className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => execCommand('italic')}
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-700 cursor-pointer"
                            title="Kursiv (Strg+I)"
                        >
                            <Italic className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={handleCreateLink}
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-700 cursor-pointer"
                            title="Link einfügen"
                        >
                            <Link2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => execCommand('insertUnorderedList')}
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-700 cursor-pointer"
                            title="Aufzählung"
                        >
                            <List className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}

                {/* Available Placeholder Chips */}
                <div className="flex items-center gap-1 ml-auto flex-wrap">
                    <span className="text-[10px] text-slate-400">Platzhalter:</span>
                    {availablePlaceholders.map(p => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => insertTag(p)}
                            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-colors cursor-pointer"
                            title={`Klicken um {{ ${p} }} einzufügen`}
                        >
                            +{p}
                        </button>
                    ))}
                </div>
            </div>

            {/* Editor Area */}
            {mode === 'visual' ? (
                <div
                    ref={visualEditorRef}
                    contentEditable
                    onInput={handleVisualInput}
                    className="p-4 text-[13.5px] leading-[1.55] focus:outline-none min-h-[160px] max-h-[360px] overflow-y-auto text-slate-800 [&>p]:my-3.5 [&>p]:leading-[1.55] [&>h2]:mt-0 [&>h2]:mb-3.5 [&>h2]:text-[18px] [&>h2]:font-bold [&>h2]:text-slate-900"
                    style={{ minHeight: `${rows * 24}px` }}
                />
            ) : (
                <textarea
                    value={html}
                    onChange={e => onChange(e.target.value)}
                    rows={rows}
                    className="w-full p-3 font-mono text-[11px] leading-relaxed border-0 focus:outline-none bg-slate-50/60 text-slate-800 resize-y"
                    required
                />
            )}
        </div>
    );
}
