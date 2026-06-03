package com.ems.test;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.ui.ExpectedConditions;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 导航、控制台、员工列表、退出登录
 */
class EmployeeAndNavTest extends BaseWebTest {

    @Test
    @DisplayName("TC-D01 控制台统计区域可见")
    void dashboardVisible() {
        loginAsAdmin();
        openPanel("dashboard");
        assertTrue(driver.findElement(By.id("panel-dashboard")).isDisplayed());
    }

    @Test
    @DisplayName("TC-E01 员工列表筛选按钮可触发加载")
    void employeeFilterLoadsTable() {
        loginAsAdmin();
        openPanel("employees");
        driver.findElement(By.id("empFilterBtn")).click();
        WebElement body = wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("empListBody")));
        String html = body.getText();
        assertFalse(html.contains("加载中"), "筛选后表格应完成加载");
    }

    @Test
    @DisplayName("TC-E05 边界值：空关键字筛选应返回列表")
    void employeeEmptySearch() {
        loginAsAdmin();
        openPanel("employees");
        driver.findElement(By.id("empListSearch")).clear();
        driver.findElement(By.id("empFilterBtn")).click();
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("empListBody")));
        assertTrue(driver.findElement(By.id("empListBody")).findElements(By.tagName("tr")).size() >= 1);
    }

    @Test
    @DisplayName("TC-N01 场景法：切换部门管理面板")
    void openDepartmentPanel() {
        loginAsAdmin();
        openPanel("departments");
        assertTrue(driver.findElement(By.id("deptStatsBody")).isDisplayed());
    }

    @Test
    @DisplayName("TC-X01 退出登录返回登录页")
    void logoutReturnsToLogin() {
        loginAsAdmin();
        driver.findElement(By.id("logoutBtn")).click();
        wait.until(ExpectedConditions.urlContains("login.html"));
        assertTrue(driver.getCurrentUrl().contains("login.html"));
    }
}
