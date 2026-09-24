import { Outlet } from "react-router-dom";
import CustomBetsTopBar from "./CustomBetsTopBar";
import CustomBetsNav from "./CustomBetsNav";
import styles from "./CustomBetsLayout.module.css";

export default function CustomBetsLayout() {
  return (
    <div className={styles.page}>
      <CustomBetsTopBar />
      <CustomBetsNav />
      <div className={styles.body}>
        <Outlet />
      </div>
    </div>
  );
}