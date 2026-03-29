import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Youtube, Loader2, AlertCircle } from "lucide-react";
import { useAddChannel } from "../hooks/use-channels";

interface AddChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddChannelModal({ isOpen, onClose }: AddChannelModalProps) {
  const [input, setInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const addMutation = useAddChannel();

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setInput("");
      setErrorMsg("");
      addMutation.reset();
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    setErrorMsg("");
    addMutation.mutate({ data: { youtubeChannelId: input.trim() } }, {
      onSuccess: () => {
        onClose();
      },
      onError: (error: any) => {
        // Try to extract a clean error message from standard fetch wrapper
        const msg = error?.response?.data?.error || error?.message || "Failed to add channel. Please check the ID and try again.";
        setErrorMsg(msg);
      }
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm" 
            onClick={onClose} 
          />
          
          {/* Modal */}
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 10 }} 
            animate={{ scale: 1, opacity: 1, y: 0 }} 
            exit={{ scale: 0.95, opacity: 0, y: 10 }} 
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="bg-surface border border-border p-6 rounded-2xl w-full max-w-md relative z-10 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)]"
          >
            {/* Close Button */}
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-text-muted hover:text-white hover:bg-surface-hover rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 text-primary">
                <Youtube className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-text-main">Add Channel</h2>
                <p className="text-sm text-text-muted">Enter a channel ID or @handle</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="channelInput" className="text-sm font-medium text-text-main ml-1">
                  Channel Identifier
                </label>
                <div className="relative">
                  <input 
                    id="channelInput"
                    autoFocus
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="e.g. @mkbhd or UC..." 
                    className="w-full bg-background border-2 border-border focus:border-primary text-text-main rounded-xl px-4 py-3 outline-none transition-colors placeholder:text-border-hover placeholder:font-light"
                    disabled={addMutation.isPending}
                  />
                  {addMutation.isPending && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-primary">
                      <Loader2 className="w-5 h-5 animate-spin" />
                    </div>
                  )}
                </div>
                
                {/* Error Message */}
                <AnimatePresence>
                  {errorMsg && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }} 
                      animate={{ opacity: 1, height: "auto" }} 
                      exit={{ opacity: 0, height: 0 }}
                      className="text-red-400 text-sm flex items-start gap-1.5 mt-1 overflow-hidden"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{errorMsg}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="mt-4 flex gap-3">
                <button 
                  type="button" 
                  onClick={onClose}
                  className="flex-1 px-4 py-3 rounded-xl font-medium text-text-main bg-surface-hover hover:bg-border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  disabled={addMutation.isPending}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={addMutation.isPending || !input.trim()}
                  className="flex-1 px-4 py-3 rounded-xl font-medium text-white bg-primary hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-primary/20 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  {addMutation.isPending ? "Adding..." : "Add Channel"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
