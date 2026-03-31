/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, ChangeEvent } from 'react';
import { Download, ImagePlus, Trash2, Settings2, Images, ChevronLeft, ChevronRight, Plus, Save, FolderOpen, Loader2 } from 'lucide-react';
import { jsPDF } from 'jspdf';
import resize from '@jsquash/resize';
import encodeJpeg from '@jsquash/jpeg/encode';

interface PageData {
  rows: number;
  cols: number;
  margin: number;
  gap: number;
  images: Record<string, string>;
}

export default function App() {
  // Multi-page state
  const [pages, setPages] = useState<PageData[]>([{
    rows: 4,
    cols: 3,
    margin: 5,
    gap: 2,
    images: {}
  }]);
  const [currentPage, setCurrentPage] = useState<number>(0);
  
  // Current page layout getters
  const currentPageData = pages[currentPage] || pages[0];
  const { rows, cols, margin, gap, images: currentImages } = currentPageData;

  const updateCurrentPageLayout = (updates: Partial<PageData>) => {
    setPages(prev => {
      const newPages = [...prev];
      newPages[currentPage] = { ...newPages[currentPage], ...updates };
      return newPages;
    });
  };
  
  // Compression quality (Squoosh-like approach)
  const [quality, setQuality] = useState<number>(0.8);
  const [engine, setEngine] = useState<'squoosh' | 'canvas'>('squoosh');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchFileInputRef = useRef<HTMLInputElement>(null);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  
  const [activeCell, setActiveCell] = useState<string | null>(null);
  const [draggedCell, setDraggedCell] = useState<string | null>(null);

  const A4_WIDTH = 210;
  const A4_HEIGHT = 297;

  // Calculate grid dimensions
  const availableWidth = A4_WIDTH - 2 * margin;
  const availableHeight = A4_HEIGHT - 2 * margin;
  
  const maxCellWidth = (availableWidth - (cols - 1) * gap) / cols;
  const maxCellHeight = (availableHeight - (rows - 1) * gap) / rows;
  
  const cellSize = Math.max(0, Math.min(maxCellWidth, maxCellHeight));
  
  const gridTotalWidth = cols * cellSize + (cols - 1) * gap;
  const gridTotalHeight = rows * cellSize + (rows - 1) * gap;
  
  const startX = margin + (availableWidth - gridTotalWidth) / 2;
  const startY = margin + (availableHeight - gridTotalHeight) / 2;

  const processImageFile = (file: File): Promise<string | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (typeof event.target?.result === 'string') {
          const dataUrl = event.target.result;
          const img = new Image();
          img.onload = async () => {
            const size = Math.min(img.width, img.height);
            const MAX_DIMENSION = 1200;
            const targetSize = Math.min(size, MAX_DIMENSION);
            const startX = (img.width - size) / 2;
            const startY = (img.height - size) / 2;

            if (engine === 'squoosh') {
              try {
                // 1. Draw original image to canvas to get ImageData
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return resolve(null);
                
                ctx.drawImage(img, 0, 0);
                
                // 2. Crop to square
                const croppedImageData = ctx.getImageData(startX, startY, size, size);
                
                // 3. Resize using Squoosh's Lanczos3 algorithm (WebAssembly)
                let finalImageData = croppedImageData;
                if (size > targetSize) {
                  finalImageData = await resize(croppedImageData, { width: targetSize, height: targetSize, method: 'lanczos3' });
                }
                
                // 4. Encode using Squoosh's MozJPEG encoder (WebAssembly)
                const jpegBuffer = await encodeJpeg(finalImageData, { quality: Math.round(quality * 100) });
                
                // 5. Convert to Data URL
                const blob = new Blob([jpegBuffer], { type: 'image/jpeg' });
                const reader2 = new FileReader();
                reader2.onloadend = () => resolve(reader2.result as string);
                reader2.readAsDataURL(blob);
                return;
              } catch (err) {
                console.warn("Squoosh Wasm compression failed, falling back to native Canvas API", err);
              }
            }

            // Fallback or Native Canvas mode
            const canvas = document.createElement('canvas');
            canvas.width = targetSize;
            canvas.height = targetSize;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(img, startX, startY, size, size, 0, 0, targetSize, targetSize);
              resolve(canvas.toDataURL('image/jpeg', quality));
            } else {
              resolve(null);
            }
          };
          img.onerror = () => resolve(null);
          img.src = dataUrl;
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  };

  const handleCellClick = (id: string) => {
    setActiveCell(id);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeCell) return;

    setIsProcessing(true);
    const dataUrl = await processImageFile(file);
    if (dataUrl) {
      setPages((prev) => {
        const newPages = [...prev];
        newPages[currentPage] = { 
          ...newPages[currentPage], 
          images: { ...newPages[currentPage].images, [activeCell]: dataUrl } 
        };
        return newPages;
      });
    }
    setIsProcessing(false);
  };

  const handleBatchUploadClick = () => {
    if (batchFileInputRef.current) {
      batchFileInputRef.current.value = '';
      batchFileInputRef.current.click();
    }
  };

  const handleBatchFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsProcessing(true);
    
    // Process sequentially to avoid crashing the browser with too many Wasm instances
    const validImages: string[] = [];
    for (const file of files) {
      const url = await processImageFile(file);
      if (url) validImages.push(url);
    }

    if (validImages.length === 0) {
      setIsProcessing(false);
      return;
    }

    setPages(prev => {
      const newPages = [...prev];
      let currentP = currentPage;
      let imgIndex = 0;

      while (imgIndex < validImages.length) {
        if (!newPages[currentP]) {
          // Inherit layout from the previous page
          const prevPage = newPages[currentP - 1];
          newPages[currentP] = {
            rows: prevPage.rows,
            cols: prevPage.cols,
            margin: prevPage.margin,
            gap: prevPage.gap,
            images: {}
          };
        }

        const emptyCells: string[] = [];
        const currentLayout = newPages[currentP];
        for (let r = 0; r < currentLayout.rows; r++) {
          for (let c = 0; c < currentLayout.cols; c++) {
            const id = `${r}-${c}`;
            if (!currentLayout.images[id]) {
              emptyCells.push(id);
            }
          }
        }

        // If current page is full, create a new page and continue
        if (emptyCells.length === 0) {
          currentP++;
          continue;
        }

        let emptyIndex = 0;
        while (emptyIndex < emptyCells.length && imgIndex < validImages.length) {
          const cellId = emptyCells[emptyIndex];
          newPages[currentP].images[cellId] = validImages[imgIndex];
          emptyIndex++;
          imgIndex++;
        }
      }
      
      setCurrentPage(currentP);
      return newPages;
    });
    setIsProcessing(false);
  };

  const handleRemoveImage = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setPages((prev) => {
      const newPages = [...prev];
      const newImages = { ...newPages[currentPage].images };
      delete newImages[id];
      newPages[currentPage] = { ...newPages[currentPage], images: newImages };
      return newPages;
    });
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => {
    setDraggedCell(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedCell || draggedCell === targetId) return;

    setPages((prev) => {
      const newPages = [...prev];
      const newImages = { ...newPages[currentPage].images };
      
      const draggedImg = newImages[draggedCell];
      const targetImg = newImages[targetId];

      if (draggedImg) newImages[targetId] = draggedImg;
      else delete newImages[targetId];

      if (targetImg) newImages[draggedCell] = targetImg;
      else delete newImages[draggedCell];

      newPages[currentPage] = { ...newPages[currentPage], images: newImages };
      return newPages;
    });
    setDraggedCell(null);
  };

  const handleDragEnd = () => {
    setDraggedCell(null);
  };

  // Pagination Controls
  const addPageBefore = () => {
    setPages(prev => {
      const newPages = [...prev];
      const currentLayout = prev[currentPage];
      newPages.splice(currentPage, 0, { ...currentLayout, images: {} });
      return newPages;
    });
    // currentPage index remains the same, which now points to the newly inserted empty page
  };

  const addPageAfter = () => {
    setPages(prev => {
      const newPages = [...prev];
      const currentLayout = prev[currentPage];
      newPages.splice(currentPage + 1, 0, { ...currentLayout, images: {} });
      return newPages;
    });
    setCurrentPage(prev => prev + 1);
  };

  const removeCurrentPage = () => {
    if (pages.length === 1) {
      setPages([{ rows: 4, cols: 3, margin: 5, gap: 2, images: {} }]);
      return;
    }
    setPages(prev => {
      const newPages = prev.filter((_, i) => i !== currentPage);
      setCurrentPage(Math.min(currentPage, newPages.length - 1));
      return newPages;
    });
  };

  // Project Save/Load
  const saveProject = () => {
    const projectData = { version: 2, pages };
    const blob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'grid-project.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadProject = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.version === 2 && data.pages) {
          setPages(data.pages);
          setCurrentPage(0);
        } else if (data.pages && data.rows !== undefined) {
          // Migrate old format
          const migratedPages = data.pages.map((p: any) => ({
            rows: data.rows,
            cols: data.cols,
            margin: data.margin,
            gap: data.gap,
            images: p
          }));
          setPages(migratedPages);
          setCurrentPage(0);
        }
      } catch (err) {
        console.error('Invalid project file. Could not load.', err);
      }
    };
    reader.readAsText(file);
    if (projectFileInputRef.current) projectFileInputRef.current.value = '';
  };

  const exportPDF = () => {
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    pages.forEach((pageData, pageIndex) => {
      if (pageIndex > 0) {
        pdf.addPage();
      }

      const { rows: pRows, cols: pCols, margin: pMargin, gap: pGap, images: pImages } = pageData;
      
      const pAvailableWidth = A4_WIDTH - 2 * pMargin;
      const pAvailableHeight = A4_HEIGHT - 2 * pMargin;
      
      const pMaxCellWidth = (pAvailableWidth - (pCols - 1) * pGap) / pCols;
      const pMaxCellHeight = (pAvailableHeight - (pRows - 1) * pGap) / pRows;
      
      const pCellSize = Math.max(0, Math.min(pMaxCellWidth, pMaxCellHeight));
      
      const pGridTotalWidth = pCols * pCellSize + (pCols - 1) * pGap;
      const pGridTotalHeight = pRows * pCellSize + (pRows - 1) * pGap;
      
      const pStartX = pMargin + (pAvailableWidth - pGridTotalWidth) / 2;
      const pStartY = pMargin + (pAvailableHeight - pGridTotalHeight) / 2;

      for (let r = 0; r < pRows; r++) {
        for (let c = 0; c < pCols; c++) {
          const id = `${r}-${c}`;
          const x = pStartX + c * (pCellSize + pGap);
          const y = pStartY + r * (pCellSize + pGap);

          // Draw cell border
          pdf.setDrawColor(200, 200, 200);
          pdf.setLineWidth(0.5);
          pdf.rect(x, y, pCellSize, pCellSize);

          // Add image if exists
          if (pImages[id]) {
            try {
              pdf.addImage(pImages[id], 'JPEG', x, y, pCellSize, pCellSize, undefined, 'FAST');
            } catch (error) {
              console.error('Error adding image to PDF', error);
            }
          }
        }
      }
    });

    pdf.save('grid-images.pdf');
  };

  return (
    <div className="min-h-screen bg-neutral-100 flex flex-col md:flex-row font-sans text-neutral-900">
      {/* Sidebar Controls */}
      <div className="w-full md:w-80 bg-white border-r border-neutral-200 p-6 flex flex-col shadow-sm z-20 h-screen overflow-y-auto shrink-0">
        <div className="flex items-center gap-2 mb-8">
          <Settings2 className="w-6 h-6 text-indigo-600" />
          <h1 className="text-xl font-semibold tracking-tight">Grid PDF Maker</h1>
        </div>

        <div className="space-y-6 flex-1">
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">Page {currentPage + 1} Layout Settings</h2>
            
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex justify-between">
                <span>Rows</span>
                <span className="text-neutral-500">{rows}</span>
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={rows}
                onChange={(e) => updateCurrentPageLayout({ rows: Number(e.target.value) })}
                className="w-full accent-indigo-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex justify-between">
                <span>Columns</span>
                <span className="text-neutral-500">{cols}</span>
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={cols}
                onChange={(e) => updateCurrentPageLayout({ cols: Number(e.target.value) })}
                className="w-full accent-indigo-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex justify-between">
                <span>Margin (mm)</span>
                <span className="text-neutral-500">{margin}</span>
              </label>
              <input
                type="range"
                min="0"
                max="50"
                value={margin}
                onChange={(e) => updateCurrentPageLayout({ margin: Number(e.target.value) })}
                className="w-full accent-indigo-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex justify-between">
                <span>Gap (mm)</span>
                <span className="text-neutral-500">{gap}</span>
              </label>
              <input
                type="range"
                min="0"
                max="20"
                value={gap}
                onChange={(e) => updateCurrentPageLayout({ gap: Number(e.target.value) })}
                className="w-full accent-indigo-600"
              />
            </div>

            {pages.length > 1 && (
              <button
                onClick={() => {
                  setPages(prev => prev.map(p => ({
                    ...p,
                    rows,
                    cols,
                    margin,
                    gap
                  })));
                }}
                className="w-full mt-2 py-1.5 px-3 text-xs font-medium rounded-md border bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Apply to All Pages
              </button>
            )}
          </div>

          <div className="space-y-4 pt-4 border-t border-neutral-100">
            <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">Compression</h2>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Engine</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setEngine('squoosh')}
                  className={`py-1.5 px-3 text-xs font-medium rounded-md border transition-colors ${engine === 'squoosh' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}
                >
                  Squoosh (Wasm)
                </button>
                <button
                  onClick={() => setEngine('canvas')}
                  className={`py-1.5 px-3 text-xs font-medium rounded-md border transition-colors ${engine === 'canvas' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}
                >
                  Canvas (Native)
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex justify-between">
                <span>Image Quality</span>
                <span className="text-neutral-500">{Math.round(quality * 100)}%</span>
              </label>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full accent-indigo-600"
              />
              <p className="text-xs text-neutral-500 leading-relaxed">
                {engine === 'squoosh' 
                  ? 'Uses Squoosh WebAssembly (MozJPEG & Lanczos3) for extreme compression.' 
                  : 'Uses browser-native Canvas API. Extremely fast, good quality.'}
              </p>
            </div>
          </div>
          
          <div className="pt-4 border-t border-neutral-100 space-y-4">
            <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">Project & Upload</h2>
            
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={saveProject}
                className="bg-white border border-neutral-300 hover:bg-neutral-50 text-neutral-700 font-medium py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"
              >
                <Save className="w-4 h-4" />
                Save
              </button>
              <button
                onClick={() => projectFileInputRef.current?.click()}
                className="bg-white border border-neutral-300 hover:bg-neutral-50 text-neutral-700 font-medium py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"
              >
                <FolderOpen className="w-4 h-4" />
                Load
              </button>
            </div>

            <button
              onClick={handleBatchUploadClick}
              className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Images className="w-4 h-4" />
              Batch Upload Images
            </button>
          </div>
        </div>

        <div className="pt-6 mt-auto">
          <button
            onClick={exportPDF}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            <Download className="w-5 h-5" />
            Export PDF ({pages.length} {pages.length === 1 ? 'Page' : 'Pages'})
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-neutral-100/50 relative">
        
        {isProcessing && (
          <div className="absolute inset-0 z-50 bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
            <p className="text-lg font-medium text-neutral-800">Processing images with {engine === 'squoosh' ? 'Squoosh' : 'Canvas'}...</p>
            <p className="text-sm text-neutral-500">This might take a moment for large files.</p>
          </div>
        )}

        {/* Preview Area */}
        <div className="flex-1 p-4 md:p-8 flex items-center justify-center overflow-auto">
          {/* A4 Paper Container */}
          <div 
            className="bg-white shadow-xl relative transition-all"
            style={{
              width: '100%',
              maxWidth: '800px',
              aspectRatio: '210 / 297',
            }}
          >
            {/* Grid Cells */}
            {Array.from({ length: rows }).map((_, r) =>
              Array.from({ length: cols }).map((_, c) => {
                const id = `${r}-${c}`;
                const x = startX + c * (cellSize + gap);
                const y = startY + r * (cellSize + gap);
                
                const pctX = (x / A4_WIDTH) * 100;
                const pctY = (y / A4_HEIGHT) * 100;
                const pctSizeW = (cellSize / A4_WIDTH) * 100;
                const pctSizeH = (cellSize / A4_HEIGHT) * 100;

                return (
                  <div
                    key={id}
                    onClick={() => handleCellClick(id)}
                    draggable
                    onDragStart={(e) => handleDragStart(e, id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, id)}
                    onDragEnd={handleDragEnd}
                    className={`absolute border border-dashed border-neutral-300 hover:border-indigo-500 hover:bg-indigo-50/50 cursor-pointer transition-all flex items-center justify-center group overflow-hidden bg-white ${draggedCell === id ? 'opacity-40 scale-95 z-10' : 'opacity-100'}`}
                    style={{
                      left: `${pctX}%`,
                      top: `${pctY}%`,
                      width: `${pctSizeW}%`,
                      height: `${pctSizeH}%`,
                    }}
                  >
                    {currentImages[id] ? (
                      <>
                        <img 
                          src={currentImages[id]} 
                          alt={`Cell ${id}`} 
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button
                            onClick={(e) => handleRemoveImage(e, id)}
                            className="p-2 bg-white/10 hover:bg-red-500 text-white rounded-full backdrop-blur-sm transition-colors"
                            title="Remove image"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="text-neutral-300 group-hover:text-indigo-400 transition-colors flex flex-col items-center gap-2">
                        <ImagePlus className="w-6 h-6 md:w-8 md:h-8" />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Pagination Bar */}
        <div className="h-16 bg-white border-t border-neutral-200 flex items-center justify-center gap-2 sm:gap-4 px-4 shadow-sm z-10 shrink-0">
          <button 
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))} 
            disabled={currentPage === 0}
            className="p-2 text-neutral-600 hover:bg-neutral-100 rounded-full disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          
          <span className="text-sm font-medium text-neutral-700 min-w-[100px] text-center">
            Page {currentPage + 1} of {pages.length}
          </span>
          
          <button 
            onClick={() => setCurrentPage(p => Math.min(pages.length - 1, p + 1))} 
            disabled={currentPage === pages.length - 1}
            className="p-2 text-neutral-600 hover:bg-neutral-100 rounded-full disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <div className="w-px h-6 bg-neutral-300 mx-2 hidden sm:block"></div>

          <button 
            onClick={addPageBefore} 
            className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-md transition-colors"
            title="Insert a new page before this one"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add Before</span>
          </button>

          <button 
            onClick={addPageAfter} 
            className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-md transition-colors"
            title="Insert a new page after this one"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add After</span>
          </button>

          <button 
            onClick={removeCurrentPage} 
            className="flex items-center gap-1.5 text-sm font-medium text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-md transition-colors"
            title="Delete current page"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Delete Page</span>
          </button>
        </div>

      </div>

      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />
      <input
        type="file"
        ref={batchFileInputRef}
        onChange={handleBatchFileChange}
        accept="image/*"
        multiple
        className="hidden"
      />
      <input
        type="file"
        ref={projectFileInputRef}
        onChange={loadProject}
        accept=".json"
        className="hidden"
      />
    </div>
  );
}
