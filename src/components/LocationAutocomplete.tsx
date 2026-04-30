import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Navigation } from 'lucide-react';

export function LocationAutocomplete({ value, onChange, placeholder, single = false }: { value: string, onChange: (v: string) => void, placeholder?: string, single?: boolean }) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const fetchSuggestions = async (q: string) => {
    if (!q || q.length < 3) {
      setSuggestions([]);
      return;
    }
    
    // In multi-mode, search using only the last typed part
    const searchPart = single ? q : q.split(',').pop()?.trim();
    if (!searchPart || searchPart.length < 3) {
      setSuggestions([]);
      return;
    }

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchPart)}&limit=5`);
      const data = await res.json();
      const addresses = data.map((d: any) => {
        const parts = d.display_name.split(',');
        if (parts.length > 3) {
           return `${parts[0].trim()}, ${parts[parts.length-2].trim()}, ${parts[parts.length-1].trim()}`;
        }
        return d.display_name;
      });
      // Deduplicate
      setSuggestions(Array.from(new Set(addresses)) as string[]);
      setShowDropdown(true);
    } catch (e) {
      console.error(e);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    onChange(val); // Always sync up
    
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      fetchSuggestions(val);
    }, 500);
  };

  const detectLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported");
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&zoom=10`);
        const data = await res.json();
        const city = data.address.city || data.address.town || data.address.village || data.address.county || data.display_name;
        
        let newVal = city;
        if (!single) {
          let existing = value.split(',').map(s => s.trim()).filter(Boolean);
          if (!existing.includes(city)) {
            existing.push(city);
          }
          newVal = existing.join(', ');
        }
        
        setQuery(newVal);
        onChange(newVal);
        setSuggestions([]);
        setShowDropdown(false);
      } catch (err) {
        alert("Failed to reverse geocode location");
      } finally {
        setIsLocating(false);
      }
    }, () => {
      alert("Failed to get location");
      setIsLocating(false);
    });
  };

  return (
    <div className="relative">
      <div className="flex bg-gray-900 border border-gray-800 rounded-xl focus-within:border-teal-500 overflow-hidden transition-colors">
        <input 
          type="text" 
          value={query} 
          onChange={handleInputChange} 
          onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          placeholder={placeholder || (single ? "e.g. New York" : "e.g. Brooklyn, Manhattan")}
          className="w-full bg-transparent px-4 py-3 outline-none text-white placeholder-gray-500 text-sm"
        />
        <button 
          type="button" 
          onClick={detectLocation}
          className="px-4 text-teal-500 hover:bg-teal-900/30 transition-colors border-l border-gray-800 flex justify-center items-center"
          title="Use current location"
        >
           <Navigation size={18} className={isLocating ? "animate-pulse" : ""} />
        </button>
      </div>

      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-xl">
          {suggestions.map((s, i) => (
            <div 
              key={i} 
              className="px-4 py-3 hover:bg-gray-800 cursor-pointer text-sm text-gray-300 flex items-center gap-2"
              onClick={() => {
                let newVal = s;
                if (!single) {
                  const parts = value.split(',').map(x => x.trim()).filter(Boolean);
                  parts.pop(); 
                  parts.push(s);
                  newVal = parts.join(', ');
                }
                setQuery(newVal);
                onChange(newVal);
                setShowDropdown(false);
              }}
            >
              <MapPin size={14} className="text-gray-500 shrink-0" />
              <span className="truncate">{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
