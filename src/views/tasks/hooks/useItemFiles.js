import { useState, useCallback } from 'react';
import { fetchTaskItemFiles, uploadTaskItemFile, deleteTaskFile } from 'api/tasks';
import { useToast } from 'contexts/ToastContext';

export default function useItemFiles(setError) {
  const toast = useToast();
  const [itemFiles, setItemFiles] = useState([]);
  const [itemFilesLoading, setItemFilesLoading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  const loadFiles = useCallback(async (itemId) => {
    if (!itemId) return [];
    setItemFilesLoading(true);
    try {
      const data = await fetchTaskItemFiles(itemId);
      const files = data.files || [];
      setItemFiles(files);
      return files;
    } catch (err) {
      setError(err.message || 'Unable to load files');
      return [];
    } finally {
      setItemFilesLoading(false);
    }
  }, [setError]);

  const handleUploadFile = useCallback(async (activeItemId, file) => {
    if (!activeItemId || !file) return;
    setUploadingFile(true);
    setError('');
    try {
      await uploadTaskItemFile(activeItemId, file);
      const data = await fetchTaskItemFiles(activeItemId);
      setItemFiles(data.files || []);
      toast.success('File uploaded');
    } catch (err) {
      setError(err.message || 'Unable to upload file');
    } finally {
      setUploadingFile(false);
    }
  }, [setError, toast]);

  const handleDeleteFile = useCallback(async (activeItemId, fileId) => {
    if (!fileId) return;
    setError('');
    // Optimistic: remove from the list immediately; restore only if the delete
    // itself fails. A post-delete refresh failure shouldn't resurrect a row
    // that's already gone server-side.
    let previous;
    setItemFiles((current) => {
      previous = current;
      return current.filter((f) => f.id !== fileId);
    });
    try {
      await deleteTaskFile(fileId);
    } catch (err) {
      if (previous) setItemFiles(previous);
      const message = err?.response?.data?.message || err.message || 'Unable to delete file';
      setError(message);
      toast.error(message);
      return;
    }
    toast.success('File deleted');
    if (activeItemId) {
      try {
        const data = await fetchTaskItemFiles(activeItemId);
        setItemFiles(data.files || []);
      } catch {
        // Refresh is best-effort — the optimistic list is already correct.
      }
    }
  }, [setError, toast]);

  const reset = useCallback(() => {
    setItemFiles([]);
    setItemFilesLoading(true);
  }, []);

  return {
    itemFiles, itemFilesLoading, uploadingFile,
    handleUploadFile, handleDeleteFile, loadFiles, reset
  };
}
