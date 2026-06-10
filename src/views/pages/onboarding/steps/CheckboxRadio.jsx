import Radio from '@mui/material/Radio';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';

export default function CheckboxRadio(props) {
  return <Radio {...props} icon={<CheckBoxOutlineBlankIcon />} checkedIcon={<CheckBoxIcon />} />;
}


