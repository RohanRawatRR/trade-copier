'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface MultiSelectProps {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = 'Select items...',
  className,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState<{ top: number; left: number; width: number } | null>(null);

  // Calculate position once when opening
  React.useEffect(() => {
    if (open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    } else {
      setPosition(null);
    }
  }, [open]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current && 
        !containerRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleScroll = () => {
      setOpen(false);
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', handleScroll, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  const handleUnselect = (item: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selected.filter((i) => i !== item));
  };

  const handleSelect = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((i) => i !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div
        className={cn(
          'min-h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm',
          'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
          'flex flex-wrap gap-1.5 items-center cursor-pointer',
          open && 'ring-2 ring-ring ring-offset-2'
        )}
        onClick={() => setOpen(!open)}
      >
        {selected.length === 0 ? (
          <span className="text-muted-foreground text-sm">{placeholder}</span>
        ) : (
          <>
            {selected.map((item) => {
              const option = options.find((opt) => opt.value === item);
              return (
                <Badge
                  key={item}
                  variant="secondary"
                  className="mr-0 mb-0 px-2 py-0.5 text-xs"
                  onClick={(e) => handleUnselect(item, e)}
                >
                  {option?.label || item}
                  <button
                    className="ml-1.5 rounded-full outline-none hover:bg-muted"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleUnselect(item, e as any);
                      }
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => handleUnselect(item, e)}
                  >
                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </Badge>
              );
            })}
          </>
        )}
        <button
          className="ml-auto flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open && position && typeof window !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] rounded-md border bg-popover shadow-lg"
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${position.width}px`,
          }}
        >
          <div className="max-h-60 overflow-auto p-1">
            {options.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">No options available</div>
            ) : (
              options.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <div
                    key={option.value}
                    className={cn(
                      'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
                      'hover:bg-accent hover:text-accent-foreground',
                      isSelected && 'bg-accent'
                    )}
                    onClick={() => handleSelect(option.value)}
                  >
                    <div className="flex items-center gap-2 flex-1">
                      {isSelected ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : (
                        <div className="h-4 w-4" />
                      )}
                      <span>{option.label}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
