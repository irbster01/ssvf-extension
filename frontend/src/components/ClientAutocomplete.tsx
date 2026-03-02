import { useState, useRef, useEffect } from 'react';
import { ClientRecord } from '../api/submissions';

interface ClientAutocompleteProps {
  clients: ClientRecord[];
  clientsLoading: boolean;
  /** Current client name value */
  clientName: string;
  /** Current client ID value */
  clientId: string;
  /** Called when a client is selected or typed. selectedRecord is provided when picking from autocomplete. */
  onChange: (clientName: string, clientId: string, selectedRecord?: ClientRecord) => void;
}

/**
 * Searchable client autocomplete — type a name, pick from matches,
 * and auto-populate the client ID. If no match, the user can
 * type both fields manually.
 */
export default function ClientAutocomplete({
  clients,
  clientsLoading,
  clientName,
  clientId,
  onChange,
}: ClientAutocompleteProps) {
  const [search, setSearch] = useState(clientName);
  const [selectedClient, setSelectedClient] = useState<ClientRecord | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // On mount, try to match existing data to a client record
  useEffect(() => {
    if (clients.length > 0 && !selectedClient && clientId) {
      const match = clients.find(c => c.id === clientId);
      if (match) {
        setSelectedClient(match);
        setSearch(match.clientName);
      }
    }
  }, [clients, clientId]);

  const filtered = search.length >= 1
    ? clients.filter(c =>
        c.clientName.toLowerCase().includes(search.toLowerCase()) ||
        c.id.includes(search)
      ).slice(0, 40)
    : [];

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = (client: ClientRecord) => {
    setSelectedClient(client);
    setSearch(client.clientName);
    setShowDropdown(false);
    setHighlightIndex(-1);
    onChange(client.clientName, client.id, client);
  };

  const handleClear = () => {
    setSelectedClient(null);
    setSearch('');
    onChange('', '', undefined);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      handleSelect(filtered[highlightIndex]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  const handleInputChange = (value: string) => {
    setSearch(value);
    setSelectedClient(null);
    setShowDropdown(true);
    setHighlightIndex(0);
    // Update parent with typed name (no ID yet — user hasn't picked one)
    onChange(value, clientId);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* Client Name — searchable */}
      <div style={{ position: 'relative' }} ref={dropdownRef}>
        <label>Client Name</label>
        {selectedClient ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 12px', backgroundColor: '#e8f5e9',
            borderRadius: '6px', border: '1px solid #a5d6a7',
          }}>
            <span style={{ flex: 1, fontWeight: 500 }}>
              {selectedClient.clientName}
              <span style={{ color: '#666', fontSize: '0.85em', marginLeft: '8px' }}>
                ID: {selectedClient.id}
              </span>
            </span>
            <button
              type="button"
              onClick={handleClear}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1em', color: '#666' }}
            >✕</button>
          </div>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={e => handleInputChange(e.target.value)}
            onFocus={() => { if (search.length >= 1) setShowDropdown(true); }}
            onKeyDown={handleKeyDown}
            placeholder={clientsLoading ? 'Loading clients…' : 'Search by client name or ID…'}
            autoComplete="off"
          />
        )}
        {showDropdown && !selectedClient && search.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
            backgroundColor: '#fff', border: '1px solid #d1d5db', borderRadius: '6px',
            maxHeight: '200px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 14px', color: '#999', fontSize: '0.9em' }}>
                No matching clients — enter manually below
              </div>
            ) : (
              filtered.map((c, idx) => (
                <div
                  key={c.id}
                  onClick={() => handleSelect(c)}
                  style={{
                    padding: '8px 14px', cursor: 'pointer', fontSize: '0.9em',
                    backgroundColor: idx === highlightIndex ? '#e3f2fd' : '#fff',
                  }}
                  onMouseEnter={() => setHighlightIndex(idx)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 500 }}>{c.clientName}</span>
                    <span style={{ color: '#888', fontSize: '0.82em', marginLeft: '8px', flexShrink: 0 }}>{c.id}</span>
                  </div>
                  {c.provider && (
                    <div style={{ color: '#999', fontSize: '0.78em', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.provider}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Client ID — auto-filled or manual */}
      {!selectedClient && (
        <div>
          <label>Client ID</label>
          <input
            type="text"
            value={clientId}
            onChange={e => onChange(search || clientName, e.target.value)}
            placeholder="Wellsky Client ID"
          />
        </div>
      )}
    </div>
  );
}
