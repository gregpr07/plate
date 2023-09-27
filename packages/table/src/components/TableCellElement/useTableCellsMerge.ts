import {
  findNode,
  findNodePath,
  getNodeString,
  getPluginType,
  insertElements,
  removeNodes,
  TDescendant,
  useEditorRef,
} from '@udecode/plate-common';

import { ELEMENT_TABLE } from '../../createTablePlugin';
import { useTableStore } from '../../stores';
import {
  TTableCellElement,
  TTableElement,
  TTableRowElement,
} from '../../types';
import { getCellTypes, getEmptyCellNode } from '../../utils/index';

const getRowSpanInFirstCol = (table: TTableCellElement, colIndex: number) => {
  return table.children.reduce((acc, cur) => {
    const rowEl = cur as TTableRowElement;
    const cellEl = rowEl.children.find((cell) => {
      const cellElem = cell as TTableCellElement;
      return cellElem?.colIndex === colIndex;
    }) as TTableCellElement;

    if (colIndex === cellEl?.colIndex) {
      const curRowSpan = cellEl?.rowSpan || 1;
      return acc + curRowSpan;
    }
    return acc;
  }, 0);
};

export const useTableCellsMerge = () => {
  const editor = useEditorRef();

  const cellEntries = useTableStore().get.selectedCellEntries();
  const subTable = useTableStore().get.selectedSubTable();

  const onMergeCells = () => {
    const selectedCellEntries = cellEntries!;
    const [[table]] = subTable!;

    const firstRow = table.children?.[0] as TTableRowElement;

    // define colSpan
    const colSpan = firstRow.children.reduce((acc, cur) => {
      const cellElement = cur as TTableCellElement;
      return acc + (cellElement?.colSpan || 1);
    }, 0);

    // define rowSpan
    const firstCell = firstRow.children?.[0] as TTableCellElement;
    const firstColIndex = firstCell.colIndex!;
    const rowSpan = getRowSpanInFirstCol(table, firstColIndex);

    const [, startCellPath] = selectedCellEntries[0];

    const contents = [];
    for (const cellEntry of selectedCellEntries) {
      const [el] = cellEntry;

      if (getNodeString(el)) {
        contents.push(...el.children); // TODO: consider using deep clone
      }
    }

    const cols: any = {};
    let hasHeaderCell = false;
    selectedCellEntries.forEach(([entry, path]) => {
      if (!hasHeaderCell && entry.type === 'table_header_cell') {
        hasHeaderCell = true;
      }
      if (cols[path[1]]) {
        cols[path[1]].push(path);
      } else {
        cols[path[1]] = [path];
      }
    });

    // removes multiple cells with on same path.
    // once cell removed, next cell in the row will settle down on that path
    Object.values(cols).forEach((paths: any) => {
      paths?.forEach(() => {
        removeNodes(editor, { at: paths[0] });
      });
    });

    const mergedCell = {
      ...getEmptyCellNode(editor, {
        header: selectedCellEntries[0][0].type === 'th',
        newCellChildren: contents,
      }),
      colSpan,
      rowSpan,
    };

    insertElements(editor, mergedCell, { at: startCellPath, select: true });
  };

  const onUnmerge = () => {
    const selectedCellEntries = cellEntries!;
    const [[cellElem, path]] = selectedCellEntries;

    // creating new object per iteration is essential here
    const createEmptyCell = (children?: TDescendant[]) => {
      return {
        ...getEmptyCellNode(editor, {
          header: cellElem.type === 'th',
          newCellChildren: children,
        }),
        colSpan: 1,
        rowSpan: 1,
      };
    };

    const tablePath = path.slice(0, -2);

    const cellPath = path.slice(-2);
    const [rowPath, colPath] = cellPath;
    const colSpan = cellElem.colSpan;
    const rowSpan = cellElem.rowSpan;

    const colPaths = Array.from(
      { length: colSpan } as ArrayLike<number>,
      (_, index) => index
    ).map((current) => colPath + current);

    let paths = Array.from(
      { length: rowSpan } as ArrayLike<number>,
      (_, index) => index
    ).map((current) => {
      const currentRowPath = rowPath + current;
      return colPaths.map((currentColPath) => [
        ...tablePath,
        currentRowPath,
        currentColPath,
      ]);
    });

    const tableEntry = findNode(editor, {
      at: path,
      match: { type: getPluginType(editor, ELEMENT_TABLE) },
    });
    const table = tableEntry?.[0] as TTableElement;

    paths = paths.map((cellsPaths) => {
      const currentPath = cellsPaths[0]; // pick starting cell in the row
      const [rowIndex, colIndex] = currentPath.slice(-2);

      let newCellPaths = cellsPaths;
      if (colIndex > 0) {
        const prevCellInRowPath = [...tablePath, rowIndex, colIndex - 1];
        const foundEntry = findNode(editor, {
          at: prevCellInRowPath,
          match: { type: getCellTypes(editor) },
        });

        /**
         * Search for the last cell path in the row.
         * We can't just paste new cell with path gaps.
         * Slate needs elements with paths one by each other.
         */
        if (!foundEntry) {
          const currentRow = table.children[rowIndex] as TTableRowElement;
          const endingCell = currentRow.children.at(-1)!;
          const endingCellPath = findNodePath(editor, endingCell)!;

          const [, startingColIndex] = endingCellPath.slice(-2);
          const startWith =
            startingColIndex === 0 ? startingColIndex : startingColIndex + 1;

          newCellPaths = cellsPaths.map((currentCellPath, i) => {
            const currentRowPath = currentCellPath.slice(0, -1);
            const newPath = [...currentRowPath, startWith + i]; // adjust column path
            return newPath;
          });
        }
      }
      return newCellPaths;
    });

    // remove merged cell
    removeNodes(editor, { at: path });

    // insert new cells
    paths
      .flat()
      .forEach((p, index) =>
        insertElements(
          editor,
          index === 0 ? createEmptyCell(cellElem.children) : createEmptyCell(),
          { at: p }
        )
      );
  };

  return { cellEntries, subTable, onMergeCells, onUnmerge };
};