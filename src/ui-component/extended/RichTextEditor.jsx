import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

import Box from '@mui/material/Box';
import GlobalStyles from '@mui/material/GlobalStyles';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import ClassicEditor from '@ckeditor/ckeditor5-build-classic';

const DEFAULT_TOOLBAR = ['heading', '|', 'bold', 'italic', 'link', 'bulletedList', 'numberedList', 'blockQuote', '|', 'undo', 'redo'];

/**
 * Reusable controlled rich-text (WYSIWYG) editor built on CKEditor 5 ClassicEditor.
 * Emits HTML via onChange. Designed to work inside MUI Dialogs — the global style
 * below raises CKEditor's balloon/dropdown panels above the dialog backdrop.
 *
 * Props:
 *  - value: HTML string (controlled)
 *  - onChange(html): called with the editor's HTML output on every change
 *  - placeholder?: editor placeholder text
 *  - minHeight?: editable area min-height (number px or CSS string), default 200
 */
export default function RichTextEditor({ value = '', onChange, placeholder, minHeight = 200, disabled = false }) {
  const editorRef = useRef(null);

  // Keep the editor in sync when value is replaced from outside (e.g. template prefill).
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getData() !== (value || '')) {
      editor.setData(value || '');
    }
  }, [value]);

  return (
    <>
      {/* MUI Dialog sits at ~1300; lift CKEditor panels above it so toolbar
          dropdowns and link balloons are clickable inside the dialog. */}
      <GlobalStyles styles={{ '.ck-body-wrapper': { zIndex: 1500 } }} />
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          '& .ck-editor__editable': { minHeight }
        }}
      >
        <CKEditor
          editor={ClassicEditor}
          disabled={disabled}
          data={value || ''}
          config={{
            toolbar: DEFAULT_TOOLBAR,
            placeholder
          }}
          onReady={(editor) => {
            editorRef.current = editor;
            if (editor.getData() !== (value || '')) {
              editor.setData(value || '');
            }
          }}
          onChange={(_, editor) => {
            onChange?.(editor.getData());
          }}
        />
      </Box>
    </>
  );
}

RichTextEditor.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func,
  placeholder: PropTypes.string,
  minHeight: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  disabled: PropTypes.bool
};
