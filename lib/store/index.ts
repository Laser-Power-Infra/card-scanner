import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";
import contactsReducer from "./contactsSlice";

export const makeStore = () =>
  configureStore({
    reducer: {
      contacts: contactsReducer,
    },
    // scanCards/importSpreadsheet take File args, which land in action.meta.arg.
    // They are never stored in state, so skip the serializability check there.
    middleware: (getDefault) =>
      getDefault({ serializableCheck: { ignoredActionPaths: ["meta.arg"] } }),
  });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
